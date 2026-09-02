// The risk/return battery a buy-side risk desk would run on any candidate
// before it is allowed near a portfolio. Every metric is computed from the
// return vector supplied and annualised with the stated periods-per-year.

import {
  mean, stdev, skewness, kurtosis, quantile, autocorrelation,
  normalCdf, normalInv, tPValue, clamp, sum, EPS,
} from './mathx.js';
import { equityCurve } from './series.js';

/** Geometric annualised growth rate implied by a return vector. */
export function cagr(returns, periodsPerYear) {
  if (!returns.length) return NaN;
  let growth = 1;
  for (const r of returns) growth *= 1 + r;
  if (growth <= 0) return -1;
  return growth ** (periodsPerYear / returns.length) - 1;
}

export function annualisedVol(returns, periodsPerYear) {
  return stdev(returns) * Math.sqrt(periodsPerYear);
}

/** Downside deviation below a per-period minimum acceptable return. */
export function downsideDeviation(returns, mar = 0) {
  if (!returns.length) return NaN;
  let acc = 0;
  for (const r of returns) {
    const d = Math.min(0, r - mar);
    acc += d * d;
  }
  return Math.sqrt(acc / returns.length);
}

export function drawdownSeries(returns) {
  const curve = equityCurve(returns);
  const dd = [];
  let peak = curve[0];
  for (const v of curve) {
    if (v > peak) peak = v;
    dd.push(v / peak - 1);
  }
  return dd;
}

export function maxDrawdown(returns) {
  const dd = drawdownSeries(returns);
  return dd.length ? Math.min(...dd) : NaN;
}

/**
 * Longest peak-to-recovery stretch, and whether the worst drawdown has been
 * recovered at all. A deep drawdown that never recovered is a different
 * animal from one that healed in a month.
 */
export function drawdownProfile(returns, periodsPerYear) {
  const dd = drawdownSeries(returns);
  let longest = 0;
  let current = 0;
  for (const v of dd) {
    if (v < -1e-9) current += 1;
    else {
      longest = Math.max(longest, current);
      current = 0;
    }
  }
  const stillUnderwater = current;
  longest = Math.max(longest, current);
  return {
    maxDrawdown: dd.length ? Math.min(...dd) : NaN,
    longestDrawdownYears: longest / periodsPerYear,
    currentDrawdown: dd.length ? dd[dd.length - 1] : NaN,
    underwaterYears: stillUnderwater / periodsPerYear,
    recovered: stillUnderwater === 0,
  };
}

/** Ulcer index: RMS of the drawdown path — penalises depth *and* duration. */
export function ulcerIndex(returns) {
  const dd = drawdownSeries(returns);
  if (!dd.length) return NaN;
  return Math.sqrt(sum(dd.map((d) => (d * 100) ** 2)) / dd.length) / 100;
}

export function sharpe(returns, periodsPerYear, rfAnnual = 0) {
  const rfPer = rfAnnual / periodsPerYear;
  const excess = returns.map((r) => r - rfPer);
  const s = stdev(excess);
  if (!(s > EPS)) return NaN;
  return (mean(excess) / s) * Math.sqrt(periodsPerYear);
}

export function sortino(returns, periodsPerYear, rfAnnual = 0) {
  const rfPer = rfAnnual / periodsPerYear;
  const excess = returns.map((r) => r - rfPer);
  const dd = downsideDeviation(excess, 0);
  if (!(dd > EPS)) return NaN;
  return (mean(excess) / dd) * Math.sqrt(periodsPerYear);
}

export function calmar(returns, periodsPerYear) {
  const mdd = Math.abs(maxDrawdown(returns));
  if (!(mdd > EPS)) return NaN;
  return cagr(returns, periodsPerYear) / mdd;
}

/** Omega ratio: probability-weighted gains over losses about a threshold. */
export function omega(returns, thresholdPerPeriod = 0) {
  let up = 0;
  let down = 0;
  for (const r of returns) {
    const d = r - thresholdPerPeriod;
    if (d > 0) up += d;
    else down -= d;
  }
  return down > EPS ? up / down : NaN;
}

/** Historical (empirical) Value at Risk at the given confidence. */
export function historicalVaR(returns, confidence = 0.95) {
  return -quantile(returns, 1 - confidence);
}

/** Expected shortfall: mean loss conditional on breaching the VaR threshold. */
export function conditionalVaR(returns, confidence = 0.95) {
  const cut = quantile(returns, 1 - confidence);
  const tailLosses = returns.filter((r) => r <= cut);
  return tailLosses.length ? -mean(tailLosses) : NaN;
}

/**
 * Cornish-Fisher (modified) VaR. Adjusts the Gaussian quantile for skew and
 * fat tails, which is what makes it usable on real return distributions.
 */
export function modifiedVaR(returns, confidence = 0.95) {
  const m = mean(returns);
  const s = stdev(returns);
  const S = skewness(returns);
  const K = kurtosis(returns);
  if (!(s > EPS) || !Number.isFinite(S) || !Number.isFinite(K)) return NaN;
  const z = normalInv(1 - confidence);
  const zcf = z +
    ((z * z - 1) * S) / 6 +
    ((z ** 3 - 3 * z) * K) / 24 -
    ((2 * z ** 3 - 5 * z) * S * S) / 36;
  return -(m + zcf * s);
}

/** Ratio of the size of the right tail to the left tail (>1 is friendly). */
export function tailRatio(returns, p = 0.05) {
  const right = Math.abs(quantile(returns, 1 - p));
  const left = Math.abs(quantile(returns, p));
  return left > EPS ? right / left : NaN;
}

export function hitRate(returns) {
  if (!returns.length) return NaN;
  return returns.filter((r) => r > 0).length / returns.length;
}

/** Average win divided by average loss. */
export function gainToPain(returns) {
  const losses = sum(returns.filter((r) => r < 0).map(Math.abs));
  return losses > EPS ? sum(returns) / losses : NaN;
}

/**
 * Probabilistic Sharpe Ratio (Bailey & Lopez de Prado): probability that the
 * observed Sharpe exceeds a benchmark Sharpe once non-normality and sample
 * length are accounted for. This is the honest answer to "is this track record
 * long enough to believe?".
 */
export function probabilisticSharpe(returns, periodsPerYear, benchmarkAnnualSharpe = 0) {
  const n = returns.length;
  if (n < 8) return NaN;
  const s = stdev(returns);
  if (!(s > EPS)) return NaN;
  const srHat = mean(returns) / s;                       // per-period
  const srStar = benchmarkAnnualSharpe / Math.sqrt(periodsPerYear);
  const S = skewness(returns) || 0;
  const K = (kurtosis(returns) || 0) + 3;                // convert to raw kurtosis
  const denom = Math.sqrt(Math.max(EPS, 1 - S * srHat + ((K - 1) / 4) * srHat * srHat));
  return normalCdf(((srHat - srStar) * Math.sqrt(n - 1)) / denom);
}

/**
 * Deflated Sharpe: PSR against the Sharpe you would expect the *best* of N
 * independent trials to show by luck alone. Guards against the selection bias
 * baked into any list of tickers somebody chose to write about.
 */
export function deflatedSharpe(returns, periodsPerYear, trials = 1) {
  const n = Math.max(1, trials);
  if (n <= 1) return probabilisticSharpe(returns, periodsPerYear, 0);
  const gamma = 0.5772156649;
  const e1 = normalInv(1 - 1 / n);
  const e2 = normalInv(1 - 1 / (n * Math.E));
  // Expected maximum of n standard normals (per-period Sharpe units).
  const expectedMax = (1 - gamma) * e1 + gamma * e2;
  const s = stdev(returns);
  if (!(s > EPS)) return NaN;
  // Variance of the per-period Sharpe estimator across trials.
  const srStarAnnual = expectedMax * Math.sqrt(periodsPerYear) *
    (1 / Math.sqrt(Math.max(1, returns.length - 1)));
  return probabilisticSharpe(returns, periodsPerYear, srStarAnnual);
}

/** t-statistic and p-value of the mean return being different from zero. */
export function meanSignificance(returns) {
  const n = returns.length;
  const s = stdev(returns);
  if (n < 3 || !(s > EPS)) return { t: NaN, p: NaN };
  const t = (mean(returns) / s) * Math.sqrt(n);
  return { t, p: tPValue(t, n - 1) };
}

/**
 * Hurst exponent by rescaled-range analysis. ~0.5 random walk, >0.5 trending,
 * <0.5 mean-reverting. Used to decide whether momentum or reversal logic is
 * even appropriate for an instrument.
 */
export function hurstExponent(returns) {
  const n = returns.length;
  if (n < 64) return NaN;
  const points = [];
  for (let size = 8; size <= Math.floor(n / 2); size = Math.floor(size * 1.6)) {
    const chunks = Math.floor(n / size);
    const rs = [];
    for (let c = 0; c < chunks; c++) {
      const seg = returns.slice(c * size, (c + 1) * size);
      const m = mean(seg);
      let cumulative = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (const r of seg) {
        cumulative += r - m;
        lo = Math.min(lo, cumulative);
        hi = Math.max(hi, cumulative);
      }
      const s = stdev(seg);
      if (s > EPS && hi > lo) rs.push((hi - lo) / s);
    }
    if (rs.length) points.push([Math.log(size), Math.log(mean(rs))]);
  }
  if (points.length < 3) return NaN;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > EPS ? num / den : NaN;
}

/** Realised volatility of the trailing window, annualised. */
export function trailingVol(returns, window, periodsPerYear) {
  const seg = returns.slice(Math.max(0, returns.length - window));
  return annualisedVol(seg, periodsPerYear);
}

/**
 * Full metric sheet for one instrument.
 * @param {number[]} returns per-period simple returns
 */
export function metricSheet(returns, { periodsPerYear = 252, rf = 0.04, trials = 1 } = {}) {
  const dd = drawdownProfile(returns, periodsPerYear);
  const vol = annualisedVol(returns, periodsPerYear);
  const g = cagr(returns, periodsPerYear);
  const sig = meanSignificance(returns);
  return {
    observations: returns.length,
    years: returns.length / periodsPerYear,
    cagr: g,
    annualVol: vol,
    sharpe: sharpe(returns, periodsPerYear, rf),
    sortino: sortino(returns, periodsPerYear, rf),
    calmar: calmar(returns, periodsPerYear),
    omega: omega(returns, rf / periodsPerYear),
    maxDrawdown: dd.maxDrawdown,
    currentDrawdown: dd.currentDrawdown,
    longestDrawdownYears: dd.longestDrawdownYears,
    underwaterYears: dd.underwaterYears,
    recovered: dd.recovered,
    ulcerIndex: ulcerIndex(returns),
    var95: historicalVaR(returns, 0.95),
    cvar95: conditionalVaR(returns, 0.95),
    modifiedVar95: modifiedVaR(returns, 0.95),
    skew: skewness(returns),
    excessKurtosis: kurtosis(returns),
    tailRatio: tailRatio(returns),
    hitRate: hitRate(returns),
    gainToPain: gainToPain(returns),
    autocorr1: autocorrelation(returns, 1),
    hurst: hurstExponent(returns),
    psr: probabilisticSharpe(returns, periodsPerYear, 0),
    deflatedSharpe: deflatedSharpe(returns, periodsPerYear, trials),
    tStat: sig.t,
    pValue: sig.p,
    vol1y: trailingVol(returns, Math.round(periodsPerYear), periodsPerYear),
    vol3m: trailingVol(returns, Math.round(periodsPerYear / 4), periodsPerYear),
    // Ratio > 1 means volatility is currently elevated versus its own history.
    volRegime: (() => {
      const recent = trailingVol(returns, Math.round(periodsPerYear / 4), periodsPerYear);
      return vol > EPS ? recent / vol : NaN;
    })(),
    riskAdjustedScore: Number.isFinite(g) && vol > EPS ? clamp(g / vol, -5, 5) : NaN,
  };
}
