// Benchmark-relative analytics: the "is this actually adding anything the
// index doesn't already give me?" question, which is the first thing an
// allocator asks about any candidate.

import { mean, stdev, olsWithIntercept, correlation, tPValue, EPS } from './mathx.js';

/**
 * Single-factor (market model) regression of an asset's excess returns on the
 * benchmark's excess returns.
 */
export function marketModel(assetReturns, benchReturns, { periodsPerYear = 252, rf = 0.04 } = {}) {
  const n = Math.min(assetReturns.length, benchReturns.length);
  if (n < 24) return null;
  const rfPer = rf / periodsPerYear;
  const y = assetReturns.slice(-n).map((r) => r - rfPer);
  const x = benchReturns.slice(-n).map((r) => r - rfPer);
  const fit = olsWithIntercept(x.map((v) => [v]), y);
  if (!fit) return null;

  const alphaPerPeriod = fit.beta[0];
  const beta = fit.beta[1];
  const active = assetReturns.slice(-n).map((r, i) => r - benchReturns.slice(-n)[i]);
  const te = stdev(active) * Math.sqrt(periodsPerYear);

  // Up/down capture: how much of the benchmark's good and bad days we take.
  const upIdx = [];
  const downIdx = [];
  for (let i = 0; i < n; i++) (benchReturns.slice(-n)[i] >= 0 ? upIdx : downIdx).push(i);
  const capture = (idx) => {
    if (idx.length < 4) return NaN;
    const b = mean(idx.map((i) => benchReturns.slice(-n)[i]));
    const a = mean(idx.map((i) => assetReturns.slice(-n)[i]));
    return Math.abs(b) > EPS ? a / b : NaN;
  };

  return {
    alphaAnnual: alphaPerPeriod * periodsPerYear,
    alphaTStat: fit.tStats[0],
    alphaPValue: Number.isFinite(fit.tStats[0]) ? tPValue(fit.tStats[0], fit.df) : NaN,
    beta,
    betaTStat: fit.tStats[1],
    r2: fit.r2,
    idiosyncraticVol: fit.residualStdev * Math.sqrt(periodsPerYear),
    trackingError: te,
    informationRatio: te > EPS ? (mean(active) * periodsPerYear) / te : NaN,
    correlation: correlation(assetReturns.slice(-n), benchReturns.slice(-n)),
    upCapture: capture(upIdx),
    downCapture: capture(downIdx),
    observations: n,
  };
}

/**
 * Multi-factor regression against whatever proxy factor series are available
 * (e.g. market, a bond proxy, gold, small-cap). Falls back gracefully when a
 * factor is missing rather than refusing to produce anything.
 */
export function factorModel(assetReturns, factors, { periodsPerYear = 252, rf = 0.04 } = {}) {
  const names = Object.keys(factors).filter((k) => factors[k]?.length);
  if (!names.length) return null;
  const n = Math.min(assetReturns.length, ...names.map((k) => factors[k].length));
  if (n < 30 + names.length) return null;
  const rfPer = rf / periodsPerYear;
  const y = assetReturns.slice(-n).map((r) => r - rfPer);
  const X = [];
  for (let i = 0; i < n; i++) X.push(names.map((k) => factors[k].slice(-n)[i] - rfPer));
  const fit = olsWithIntercept(X, y);
  if (!fit) return null;
  const loadings = {};
  names.forEach((k, i) => {
    loadings[k] = { beta: fit.beta[i + 1], tStat: fit.tStats[i + 1] };
  });
  return {
    alphaAnnual: fit.beta[0] * periodsPerYear,
    alphaTStat: fit.tStats[0],
    loadings,
    r2: fit.r2,
    adjR2: fit.adjR2,
    residualVolAnnual: fit.residualStdev * Math.sqrt(periodsPerYear),
    observations: n,
  };
}

/**
 * Rolling correlation to the benchmark. A candidate whose diversification
 * disappears exactly when markets fall is not a diversifier, and the average
 * correlation hides that.
 */
export function correlationStability(assetReturns, benchReturns, window = 63) {
  const n = Math.min(assetReturns.length, benchReturns.length);
  if (n < window * 2) return null;
  const a = assetReturns.slice(-n);
  const b = benchReturns.slice(-n);
  const rolling = [];
  for (let end = window; end <= n; end += Math.max(1, Math.floor(window / 4))) {
    rolling.push(correlation(a.slice(end - window, end), b.slice(end - window, end)));
  }
  const valid = rolling.filter(Number.isFinite);
  if (!valid.length) return null;

  // Correlation conditional on the benchmark's worst decile of days.
  const sorted = [...b].map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const stressIdx = sorted.slice(0, Math.max(10, Math.floor(n * 0.1))).map((p) => p[1]);
  const stressCorr = correlation(stressIdx.map((i) => a[i]), stressIdx.map((i) => b[i]));

  return {
    mean: mean(valid),
    min: Math.min(...valid),
    max: Math.max(...valid),
    stdev: stdev(valid),
    stressCorrelation: stressCorr,
    samples: valid.length,
  };
}
