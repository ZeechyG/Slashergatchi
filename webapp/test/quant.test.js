import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mean, stdev, skewness, kurtosis, normalCdf, normalInv, tPValue,
  projectToSimplexBox, olsWithIntercept, solveSPD, quantile,
} from '../server/quant/mathx.js';
import {
  cagr, sharpe, sortino, maxDrawdown, historicalVaR, conditionalVaR,
  ulcerIndex, hitRate, probabilisticSharpe, metricSheet, drawdownProfile,
} from '../server/quant/metrics.js';
import { normaliseSeries, simpleReturns, alignSeries, resample } from '../server/quant/series.js';
import { marketModel } from '../server/quant/regression.js';
import {
  shrinkCovariance, riskParityWeights, maxSharpeWeights, hrpWeights,
  minVarianceWeights, riskContributions, portfolioVol, effectiveBets,
  diversificationRatio, kellyFraction,
} from '../server/quant/portfolio.js';
import { zScore, winsorise, rankPercentile } from '../server/quant/factors.js';
import { simulate, monteCarlo, walkForward } from '../server/quant/backtest.js';

const approx = (a, b, tol = 1e-6, msg) =>
  assert.ok(Math.abs(a - b) < tol, msg ?? `expected ${a} ≈ ${b} (tol ${tol})`);

/** Deterministic pseudo-random returns for reproducible tests. */
function makeReturns(n, { drift = 0.0004, vol = 0.01, seed = 42 } = {}) {
  let s = seed >>> 0;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = Math.max(1e-9, rnd());
    out.push(drift + vol * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()));
  }
  return out;
}

test('descriptive statistics match known values', () => {
  const xs = [2, 4, 4, 4, 5, 5, 7, 9];
  approx(mean(xs), 5);
  approx(stdev(xs, true), 2);                 // population sd of the classic example
  approx(stdev(xs), Math.sqrt(32 / 7), 1e-9);
  approx(quantile([1, 2, 3, 4], 0.5), 2.5);
  approx(skewness([1, 2, 3, 4, 5]), 0, 1e-9); // symmetric sample
  assert.ok(kurtosis([1, 2, 3, 4, 5]) < 0);   // platykurtic
});

test('normal distribution helpers invert each other', () => {
  approx(normalCdf(0), 0.5, 1e-7);
  approx(normalCdf(1.959964), 0.975, 1e-6);
  approx(normalInv(0.975), 1.959964, 1e-5);
  approx(normalInv(normalCdf(0.7)), 0.7, 1e-5);
});

test("Student-t p-value matches a known table value", () => {
  // Two-sided p for t = 2.0 with 30 df is 0.0546 in standard tables.
  approx(tPValue(2.0, 30), 0.0546, 5e-4);
  approx(tPValue(0, 10), 1, 1e-9);
});

test('CAGR and Sharpe are computed on the right conventions', () => {
  // Twelve monthly returns of exactly 1% compound to 12.68% a year.
  const monthly = new Array(12).fill(0.01);
  approx(cagr(monthly, 12), 1.01 ** 12 - 1, 1e-9);
  // Zero-variance returns have no defined Sharpe rather than an infinite one.
  assert.ok(Number.isNaN(sharpe(monthly, 12, 0)));

  const r = makeReturns(2520);
  const s = sharpe(r, 252, 0);
  approx(s, (mean(r) / stdev(r)) * Math.sqrt(252), 1e-9);
  assert.ok(sortino(r, 252, 0) > s, 'Sortino exceeds Sharpe when the distribution is symmetric-ish');
});

test('drawdown maths is exact on a hand-built path', () => {
  // +100%, then -50% back to the start, then -50% again.
  const rets = [1.0, -0.5, -0.5];
  approx(maxDrawdown(rets), -0.75, 1e-12);    // peak 2.0 -> trough 0.5
  const profile = drawdownProfile(rets, 252);
  assert.equal(profile.recovered, false);
  approx(profile.currentDrawdown, -0.75, 1e-12);
  assert.ok(ulcerIndex(rets) > 0);
});

test('VaR and CVaR respect their definitions', () => {
  const r = [...Array(100).keys()].map((i) => (i - 50) / 1000);  // -0.05 .. 0.049
  const var95 = historicalVaR(r, 0.95);
  const cvar95 = conditionalVaR(r, 0.95);
  assert.ok(cvar95 >= var95, 'expected shortfall is at least as large as VaR');
  approx(hitRate(r), 0.49, 1e-9);
});

test('probabilistic Sharpe rises with sample length', () => {
  const short = makeReturns(60, { drift: 0.0006, seed: 11 });
  const long = makeReturns(2000, { drift: 0.0006, seed: 11 });
  const psrShort = probabilisticSharpe(short, 252, 0);
  const psrLong = probabilisticSharpe(long, 252, 0);
  assert.ok(psrLong > psrShort, `expected ${psrLong} > ${psrShort}`);
  assert.ok(psrLong >= 0 && psrLong <= 1);
});

test('series normalisation sorts, dedupes and rejects bad rows', () => {
  const s = normaliseSeries(
    ['2024-01-03', '2024-01-02', '2024-01-02', 'garbage', '2024-01-04'],
    [3, 2, 2, 9, -1],
  );
  assert.deepEqual(s.dates, ['2024-01-02', '2024-01-03']);
  assert.deepEqual(s.closes, [2, 3]);
});

test('simple returns and alignment behave', () => {
  approx(simpleReturns([100, 110, 99])[0], 0.1, 1e-12);
  approx(simpleReturns([100, 110, 99])[1], -0.1, 1e-12);

  const aligned = alignSeries({
    A: { dates: ['2024-01-01', '2024-01-02', '2024-01-03'], closes: [1, 2, 3] },
    B: { dates: ['2024-01-02', '2024-01-03', '2024-01-04'], closes: [9, 8, 7] },
  }, 2);
  assert.deepEqual(aligned.dates, ['2024-01-02', '2024-01-03']);
  assert.deepEqual(aligned.closes.A, [2, 3]);
  assert.deepEqual(aligned.closes.B, [9, 8]);
});

test('monthly resampling keeps the last observation of each month', () => {
  const { dates, closes } = resample(
    ['2024-01-30', '2024-01-31', '2024-02-01', '2024-02-29'],
    [1, 2, 3, 4],
    'monthly',
  );
  assert.deepEqual(dates, ['2024-01-31', '2024-02-29']);
  assert.deepEqual(closes, [2, 4]);
});

test('OLS recovers known coefficients', () => {
  const X = [];
  const y = [];
  for (let i = 0; i < 200; i++) {
    const x1 = (i % 17) / 17;
    const x2 = ((i * 7) % 13) / 13;
    X.push([x1, x2]);
    y.push(3 + 2 * x1 - 1.5 * x2);
  }
  const fit = olsWithIntercept(X, y);
  approx(fit.beta[0], 3, 1e-8);
  approx(fit.beta[1], 2, 1e-8);
  approx(fit.beta[2], -1.5, 1e-8);
  approx(fit.r2, 1, 1e-9);
});

test('market model recovers a planted beta', () => {
  const bench = makeReturns(1000, { drift: 0.0003, vol: 0.01, seed: 5 });
  const noise = makeReturns(1000, { drift: 0, vol: 0.002, seed: 99 });
  const asset = bench.map((b, i) => 1.4 * b + noise[i] + 0.0002);
  const mm = marketModel(asset, bench, { rf: 0 });
  approx(mm.beta, 1.4, 0.05);
  approx(mm.alphaAnnual, 0.0002 * 252, 0.03);
  assert.ok(mm.r2 > 0.9);
  assert.ok(mm.upCapture > mm.downCapture === false || Number.isFinite(mm.upCapture));
});

test('multi-factor model attributes a planted exposure', async () => {
  const { factorModel } = await import('../server/quant/regression.js');
  const equity = makeReturns(1200, { vol: 0.01, seed: 31 });
  const bonds = makeReturns(1200, { vol: 0.004, seed: 32 });
  const noise = makeReturns(1200, { vol: 0.001, seed: 33 });
  // 60/40 by construction, plus a little unexplained drift.
  const asset = equity.map((e, i) => 0.6 * e + 0.4 * bonds[i] + noise[i] + 0.0001);

  const fm = factorModel(asset, { equity, bonds }, { rf: 0 });
  approx(fm.loadings.equity.beta, 0.6, 0.05);
  approx(fm.loadings.bonds.beta, 0.4, 0.05);
  assert.ok(fm.r2 > 0.95, `expected the two factors to explain the return, r2 = ${fm.r2}`);
  // An unrelated series should not load on them.
  const unrelated = factorModel(makeReturns(1200, { vol: 0.01, seed: 44 }), { equity, bonds }, { rf: 0 });
  assert.ok(Math.abs(unrelated.loadings.equity.beta) < 0.2);
  assert.ok(unrelated.r2 < 0.2);
});

test('SPD solver inverts a known system', () => {
  const A = [[4, 1], [1, 3]];
  const x = solveSPD(A, [1, 2]);
  approx(x[0], 1 / 11, 1e-9);
  approx(x[1], 7 / 11, 1e-9);
});

test('simplex projection respects sum and box constraints', () => {
  const w = projectToSimplexBox([0.9, 0.05, 0.05], 0, 0.4);
  approx(w.reduce((a, b) => a + b, 0), 1, 1e-9);
  assert.ok(Math.max(...w) <= 0.4 + 1e-6);
  assert.ok(Math.min(...w) >= 0);
});

test('risk parity equalises risk contributions', () => {
  const sigma = [[0.04, 0.006, 0.001], [0.006, 0.01, 0.002], [0.001, 0.002, 0.0025]];
  const w = riskParityWeights(sigma);
  const rc = riskContributions(w, sigma);
  for (const c of rc) approx(c, 1 / 3, 1e-3);
  approx(w.reduce((a, b) => a + b, 0), 1, 1e-9);
});

test('minimum variance beats equal weight on variance', () => {
  const sigma = [[0.04, 0.006, 0.001], [0.006, 0.01, 0.002], [0.001, 0.002, 0.0025]];
  const mv = minVarianceWeights(sigma);
  const eq = [1 / 3, 1 / 3, 1 / 3];
  assert.ok(portfolioVol(mv, sigma) <= portfolioVol(eq, sigma) + 1e-9);
});

test('max-Sharpe honours the weight cap and improves on equal weight', () => {
  const sigma = [[0.04, 0.006, 0.001], [0.006, 0.01, 0.002], [0.001, 0.002, 0.0025]];
  const mu = [0.12, 0.07, 0.03];
  const w = maxSharpeWeights(mu, sigma, { maxWeight: 0.5, rf: 0.02 });
  assert.ok(Math.max(...w) <= 0.5 + 1e-6, 'cap respected');
  const sr = (weights) => {
    const r = weights.reduce((a, x, i) => a + x * mu[i], 0) - 0.02;
    return r / portfolioVol(weights, sigma);
  };
  assert.ok(sr(w) >= sr([1 / 3, 1 / 3, 1 / 3]) - 1e-9);
});

test('HRP produces a valid, diversified allocation', () => {
  const sigma = [[0.04, 0.03, 0.001], [0.03, 0.045, 0.002], [0.001, 0.002, 0.0025]];
  const w = hrpWeights(sigma);
  approx(w.reduce((a, b) => a + b, 0), 1, 1e-9);
  assert.ok(w.every((x) => x >= 0));
  // The uncorrelated low-variance asset should not be starved.
  assert.ok(w[2] > 0.2, `expected the diversifier to earn weight, got ${w[2]}`);
});

test('shrinkage lands between the sample matrix and its target', () => {
  const returns = {
    A: makeReturns(300, { seed: 1 }),
    B: makeReturns(300, { seed: 2 }),
    C: makeReturns(300, { seed: 3 }),
  };
  const { sigma, delta, sample, target } = shrinkCovariance(returns, ['A', 'B', 'C']);
  assert.ok(delta >= 0 && delta <= 1, `delta ${delta} out of range`);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      approx(sigma[i][j], delta * target[i][j] + (1 - delta) * sample[i][j], 1e-12);
    }
  }
  // Variances are untouched by the constant-correlation target.
  for (let i = 0; i < 3; i++) approx(sigma[i][i], sample[i][i], 1e-12);
});

test('portfolio diagnostics behave sensibly', () => {
  approx(effectiveBets([0.5, 0.5]), 2, 1e-9);
  approx(effectiveBets([1]), 1, 1e-9);
  const sigma = [[0.04, 0], [0, 0.04]];
  assert.ok(diversificationRatio([0.5, 0.5], sigma) > 1.4);
  // Full Kelly here is 0.06/0.15^2 = 2.67x leverage; the cap holds it at 1.
  approx(kellyFraction(0.06, 0.15, { fraction: 1 }), 1, 1e-9);
  approx(kellyFraction(0.06, 0.15, { fraction: 1, cap: 5 }), 0.06 / 0.0225, 1e-9);
  // A quarter-Kelly stake on a modest edge stays well below full investment.
  approx(kellyFraction(0.03, 0.2, { fraction: 0.25 }), 0.25 * 0.03 / 0.04, 1e-9);
  approx(kellyFraction(-0.01, 0.15), 0, 1e-12);
});

test('cross-sectional scoring is standardised and bounded', () => {
  const z = zScore([1, 2, 3, 4, 100]);
  assert.equal(z.length, 5);
  assert.ok(Math.max(...z) <= 2.5 + 1e-9);
  assert.ok(z[4] > z[0], 'the largest input keeps the largest score');
  // Missing values score neutral, never favourably.
  const withGap = zScore([1, 2, 3, NaN, 5]);
  approx(withGap[3], 0, 1e-12);
  assert.deepEqual(winsorise([0, 5, 10, 100, 1000], 0.25).length, 5);
  const ranks = rankPercentile([10, 20, 30]);
  approx(ranks[0], 0, 1e-9);
  approx(ranks[2], 1, 1e-9);
});

test('backtest reproduces a buy-and-hold path exactly', () => {
  const r = makeReturns(500, { seed: 77 });
  const run = simulate([1], ['X'], { X: r }, { rebalanceEvery: 0, costBps: 0 });
  const expected = r.reduce((acc, x) => acc * (1 + x), 1);
  approx(run.equity[run.equity.length - 1], expected, 1e-9);
  approx(run.turnoverPerYear, 0, 1e-12);
});

test('rebalancing costs reduce returns', () => {
  const A = makeReturns(756, { seed: 3 });
  const B = makeReturns(756, { seed: 4 });
  const free = simulate([0.5, 0.5], ['A', 'B'], { A, B }, { rebalanceEvery: 21, costBps: 0 });
  const costly = simulate([0.5, 0.5], ['A', 'B'], { A, B }, { rebalanceEvery: 21, costBps: 50 });
  assert.ok(costly.metrics.cagr < free.metrics.cagr, 'costs must drag on returns');
  assert.ok(costly.totalCost > 0);
});

test('walk-forward only reports out-of-sample periods', () => {
  const A = makeReturns(1500, { seed: 21 });
  const B = makeReturns(1500, { seed: 22 });
  const wf = walkForward(['A', 'B'], { A, B }, () => [0.5, 0.5], { initialWindow: 252, step: 63 });
  assert.ok(wf.supported);
  assert.equal(wf.observations, wf.folds * 63);
  assert.ok(wf.observations < 1500, 'the in-sample window is excluded');
});

test('Monte Carlo is deterministic and internally ordered', () => {
  const r = makeReturns(1000, { seed: 8 });
  const a = monteCarlo(r, { horizonYears: 3, paths: 400 });
  const b = monteCarlo(r, { horizonYears: 3, paths: 400 });
  assert.deepEqual(a.terminalMultiple, b.terminalMultiple, 'same seed, same answer');
  const t = a.terminalMultiple;
  assert.ok(t.p5 <= t.p25 && t.p25 <= t.median && t.median <= t.p75 && t.p75 <= t.p95);
  assert.ok(a.probabilityOfLoss >= 0 && a.probabilityOfLoss <= 1);
});

test('metric sheet is complete and finite for a normal series', () => {
  const sheet = metricSheet(makeReturns(1260, { seed: 55 }), { periodsPerYear: 252, rf: 0.04, trials: 10 });
  for (const key of ['cagr', 'annualVol', 'sharpe', 'sortino', 'maxDrawdown', 'var95', 'cvar95', 'psr', 'skew', 'hurst']) {
    assert.ok(Number.isFinite(sheet[key]), `${key} should be finite, got ${sheet[key]}`);
  }
  assert.ok(sheet.deflatedSharpe <= sheet.psr + 1e-9, 'deflating for multiple trials cannot raise confidence');
});
