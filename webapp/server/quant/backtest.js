// Backtesting the recommendation. A weight vector nobody has ever simulated is
// an opinion; running it against the actual price path, with rebalancing and
// costs, is the minimum evidence needed to put it in front of someone.

import { sum, mean, EPS } from './mathx.js';
import { metricSheet, cagr, annualisedVol, sharpe, maxDrawdown } from './metrics.js';
import { equityCurve, TRADING_DAYS } from './series.js';

/**
 * Simulates a fixed-weight portfolio with periodic rebalancing.
 *
 * @param weights      target weights, aligned with `symbols`
 * @param returnsBySym aligned per-period return vectors
 * @param opts.rebalanceEvery periods between rebalances (21 ≈ monthly)
 * @param opts.costBps        round-trip cost per unit turnover, in basis points
 */
export function simulate(weights, symbols, returnsBySym, {
  rebalanceEvery = 21, costBps = 10, periodsPerYear = TRADING_DAYS,
} = {}) {
  const n = Math.min(...symbols.map((s) => returnsBySym[s].length));
  if (!n || !weights.length) return null;

  let holdings = [...weights];
  const portReturns = [];
  let turnover = 0;
  let costPaid = 0;

  for (let t = 0; t < n; t++) {
    const stepReturns = symbols.map((s) => returnsBySym[s][returnsBySym[s].length - n + t]);
    // Portfolio return is the weighted return of current (drifted) holdings.
    const total = sum(holdings);
    const w = total > EPS ? holdings.map((h) => h / total) : holdings;
    const r = sum(w.map((wi, i) => wi * stepReturns[i]));

    // Drift the holdings with the realised returns.
    holdings = w.map((wi, i) => wi * (1 + stepReturns[i]));

    let cost = 0;
    if (rebalanceEvery > 0 && (t + 1) % rebalanceEvery === 0) {
      const drifted = sum(holdings);
      const normalised = drifted > EPS ? holdings.map((h) => h / drifted) : holdings;
      const trade = sum(normalised.map((h, i) => Math.abs(h - weights[i])));
      turnover += trade;
      cost = (trade * costBps) / 10000;
      costPaid += cost;
      holdings = [...weights];
    }
    portReturns.push(r - cost);
  }

  const metrics = metricSheet(portReturns, { periodsPerYear, rf: 0 });
  return {
    returns: portReturns,
    equity: equityCurve(portReturns),
    metrics,
    turnoverPerYear: (turnover / n) * periodsPerYear,
    totalCost: costPaid,
    rebalanceEvery,
    costBps,
  };
}

/**
 * Walk-forward validation: re-fits the weight vector on an expanding in-sample
 * window and measures only the out-of-sample periods that follow. This is the
 * check that separates a real process from a curve fit, so the result is
 * reported even when it is unflattering.
 *
 * @param fitWeights (returnsBySymSlice, symbols) => number[]
 */
export function walkForward(symbols, returnsBySym, fitWeights, {
  initialWindow = 252, step = 63, periodsPerYear = TRADING_DAYS, costBps = 10,
} = {}) {
  const n = Math.min(...symbols.map((s) => returnsBySym[s].length));
  if (n < initialWindow + step * 2) {
    return { supported: false, reason: `Need at least ${initialWindow + step * 2} observations for walk-forward validation; have ${n}.` };
  }

  const oosReturns = [];
  const folds = [];
  for (let end = initialWindow; end + step <= n; end += step) {
    const inSample = {};
    for (const s of symbols) {
      const full = returnsBySym[s].slice(returnsBySym[s].length - n);
      inSample[s] = full.slice(0, end);
    }
    let w;
    try {
      w = fitWeights(inSample, symbols);
    } catch {
      w = symbols.map(() => 1 / symbols.length);
    }
    if (!w || w.length !== symbols.length || !w.every(Number.isFinite)) {
      w = symbols.map(() => 1 / symbols.length);
    }

    const foldReturns = [];
    let holdings = [...w];
    for (let t = end; t < end + step; t++) {
      const stepReturns = symbols.map((s) => {
        const full = returnsBySym[s].slice(returnsBySym[s].length - n);
        return full[t];
      });
      const total = sum(holdings);
      const hw = total > EPS ? holdings.map((h) => h / total) : holdings;
      foldReturns.push(sum(hw.map((wi, i) => wi * stepReturns[i])));
      holdings = hw.map((wi, i) => wi * (1 + stepReturns[i]));
    }
    // Charge a rebalance at each refit.
    const cost = (sum(w.map((wi, i) => Math.abs(wi - (folds.at(-1)?.weights?.[i] ?? 1 / symbols.length)))) * costBps) / 10000;
    if (foldReturns.length) foldReturns[0] -= cost;
    folds.push({ start: end, end: end + step, weights: w, foldReturn: foldReturns.reduce((a, b) => (1 + a) * (1 + b) - 1, 0) });
    oosReturns.push(...foldReturns);
  }

  if (oosReturns.length < 30) return { supported: false, reason: 'Too few out-of-sample periods to evaluate.' };

  return {
    supported: true,
    folds: folds.length,
    observations: oosReturns.length,
    returns: oosReturns,
    equity: equityCurve(oosReturns),
    metrics: metricSheet(oosReturns, { periodsPerYear, rf: 0 }),
  };
}

/** Equal-weight benchmark for the same universe — the honest baseline. */
export function equalWeightBaseline(symbols, returnsBySym, opts = {}) {
  return simulate(symbols.map(() => 1 / symbols.length), symbols, returnsBySym, opts);
}

/**
 * Compares candidate portfolios head to head on the metrics that decide
 * whether the extra complexity earned anything.
 */
export function compare(runs, periodsPerYear = TRADING_DAYS) {
  return Object.entries(runs)
    .filter(([, r]) => r && r.returns?.length)
    .map(([name, r]) => ({
      name,
      cagr: cagr(r.returns, periodsPerYear),
      vol: annualisedVol(r.returns, periodsPerYear),
      sharpe: sharpe(r.returns, periodsPerYear, 0),
      maxDrawdown: maxDrawdown(r.returns),
      finalMultiple: r.equity[r.equity.length - 1],
      turnoverPerYear: r.turnoverPerYear ?? 0,
    }));
}

/**
 * Monte Carlo over the *shape* of future outcomes by resampling historical
 * periods in blocks (preserving autocorrelation), then reporting the
 * distribution of terminal wealth. Presented as a range, never a point estimate.
 */
export function monteCarlo(returns, {
  horizonYears = 5, periodsPerYear = TRADING_DAYS, paths = 2000, blockSize = 21, seed = 12345,
} = {}) {
  if (returns.length < blockSize * 3) return null;
  const steps = Math.round(horizonYears * periodsPerYear);
  let s = seed >>> 0;
  const rnd = () => {
    // xorshift32 — deterministic so the same inputs always give the same range.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };

  const terminals = [];
  const maxDDs = [];
  for (let p = 0; p < paths; p++) {
    let wealth = 1;
    let peak = 1;
    let worst = 0;
    for (let t = 0; t < steps; t += blockSize) {
      const start = Math.floor(rnd() * (returns.length - blockSize));
      for (let k = 0; k < blockSize && t + k < steps; k++) {
        wealth *= 1 + returns[start + k];
        if (wealth > peak) peak = wealth;
        worst = Math.min(worst, wealth / peak - 1);
      }
    }
    terminals.push(wealth);
    maxDDs.push(worst);
  }
  terminals.sort((a, b) => a - b);
  maxDDs.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * arr.length)))];
  return {
    horizonYears,
    paths,
    terminalMultiple: {
      p5: q(terminals, 0.05), p25: q(terminals, 0.25), median: q(terminals, 0.5),
      p75: q(terminals, 0.75), p95: q(terminals, 0.95),
    },
    annualised: {
      p5: q(terminals, 0.05) ** (1 / horizonYears) - 1,
      median: q(terminals, 0.5) ** (1 / horizonYears) - 1,
      p95: q(terminals, 0.95) ** (1 / horizonYears) - 1,
    },
    worstDrawdown: { p5: q(maxDDs, 0.05), median: q(maxDDs, 0.5) },
    probabilityOfLoss: terminals.filter((t) => t < 1).length / terminals.length,
  };
}
