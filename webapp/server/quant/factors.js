// Cross-sectional factor scoring. Raw metrics are not comparable across
// instruments; what matters is where a candidate sits relative to the others
// under consideration. Everything here is winsorised, z-scored and clipped so
// one outlier cannot dominate the ranking.

import { mean, stdev, quantile, clamp, EPS } from './mathx.js';
import { TRADING_DAYS } from './series.js';

/** Trims a cross-section at the given percentiles before standardising. */
export function winsorise(values, p = 0.05) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 4) return values.map((v) => (Number.isFinite(v) ? v : NaN));
  const lo = quantile(valid, p);
  const hi = quantile(valid, 1 - p);
  return values.map((v) => (Number.isFinite(v) ? clamp(v, lo, hi) : NaN));
}

/**
 * Cross-sectional z-score. Missing values map to 0 (neutral) rather than
 * being dropped, so a candidate is never rewarded for having no data.
 */
export function zScore(values, { winsor = 0.05, clip = 2.5 } = {}) {
  const w = winsorise(values, winsor);
  const valid = w.filter(Number.isFinite);
  if (valid.length < 2) return values.map(() => 0);
  const m = mean(valid);
  const s = stdev(valid);
  if (!(s > EPS)) return values.map(() => 0);
  return w.map((v) => (Number.isFinite(v) ? clamp((v - m) / s, -clip, clip) : 0));
}

/** Percentile rank in [0,1], used where a bounded score reads better. */
export function rankPercentile(values) {
  const idx = values.map((v, i) => [v, i]).filter((p) => Number.isFinite(p[0]));
  idx.sort((a, b) => a[0] - b[0]);
  const out = values.map(() => 0.5);
  idx.forEach(([, i], k) => {
    out[i] = idx.length > 1 ? k / (idx.length - 1) : 0.5;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Per-instrument raw factor inputs
// ---------------------------------------------------------------------------

/**
 * Price-derived factor inputs for one instrument. `closes` is the aligned
 * daily close vector; `returns` its simple returns.
 */
export function rawFactors(closes, returns, metrics, market) {
  const n = closes.length;
  const last = closes[n - 1];
  const at = (daysAgo) => (n > daysAgo ? closes[n - 1 - daysAgo] : NaN);
  const ret = (daysAgo) => {
    const p = at(daysAgo);
    return Number.isFinite(p) && p > 0 ? last / p - 1 : NaN;
  };

  const sma = (win) => {
    if (n < win) return NaN;
    let acc = 0;
    for (let i = n - win; i < n; i++) acc += closes[i];
    return acc / win;
  };

  const sma50 = sma(50);
  const sma200 = sma(200);
  const high52 = n >= 252 ? Math.max(...closes.slice(-252)) : Math.max(...closes);
  const low52 = n >= 252 ? Math.min(...closes.slice(-252)) : Math.min(...closes);

  // 12-1 momentum: the classic academic construction, skipping the most recent
  // month to avoid the short-term reversal effect contaminating the signal.
  const mom12_1 = (() => {
    const p12 = at(TRADING_DAYS);
    const p1 = at(21);
    return Number.isFinite(p12) && Number.isFinite(p1) && p12 > 0 ? p1 / p12 - 1 : NaN;
  })();

  return {
    // Trend / momentum family
    momentum12_1: mom12_1,
    momentum6m: ret(126),
    momentum3m: ret(63),
    reversal1m: Number.isFinite(ret(21)) ? -ret(21) : NaN,  // short-term reversal
    trend50_200: Number.isFinite(sma50) && Number.isFinite(sma200) && sma200 > 0
      ? sma50 / sma200 - 1 : NaN,
    priceVs200: Number.isFinite(sma200) && sma200 > 0 ? last / sma200 - 1 : NaN,
    distanceFrom52wHigh: high52 > 0 ? last / high52 - 1 : NaN,
    positionIn52wRange: high52 > low52 ? (last - low52) / (high52 - low52) : NaN,

    // Risk family (signs are set so that "higher is better" everywhere)
    lowVolatility: Number.isFinite(metrics.annualVol) ? -metrics.annualVol : NaN,
    drawdownResilience: Number.isFinite(metrics.maxDrawdown) ? metrics.maxDrawdown : NaN,
    tailSafety: Number.isFinite(metrics.cvar95) ? -metrics.cvar95 : NaN,
    skewPreference: metrics.skew,
    ulcerSafety: Number.isFinite(metrics.ulcerIndex) ? -metrics.ulcerIndex : NaN,

    // Quality / persistence family
    riskAdjusted: metrics.sharpe,
    sortino: metrics.sortino,
    calmar: metrics.calmar,
    consistency: metrics.hitRate,
    statisticalConfidence: metrics.psr,
    trendPersistence: Number.isFinite(metrics.hurst) ? metrics.hurst - 0.5 : NaN,

    // Benchmark-relative family
    alpha: market?.alphaAnnual,
    informationRatio: market?.informationRatio,
    lowBeta: Number.isFinite(market?.beta) ? -Math.abs(market.beta) : NaN,
    diversification: Number.isFinite(market?.correlation) ? -market.correlation : NaN,
    downsideProtection: Number.isFinite(market?.downCapture) ? -market.downCapture : NaN,
    captureSpread: Number.isFinite(market?.upCapture) && Number.isFinite(market?.downCapture)
      ? market.upCapture - market.downCapture : NaN,

    // Valuation proxies. Without fundamentals we use the mean-reversion read a
    // technical analyst would use: how stretched is price versus its own history.
    valueProxy: Number.isFinite(sma200) && sma200 > 0 ? -(last / sma200 - 1) : NaN,
    drawdownValue: Number.isFinite(metrics.currentDrawdown) ? metrics.currentDrawdown * -1 : NaN,
  };
}

/**
 * Factor families and their members. Grouping matters: scoring 20 correlated
 * signals individually would silently triple-count momentum.
 */
export const FACTOR_FAMILIES = {
  momentum: {
    label: 'Momentum & Trend',
    members: {
      momentum12_1: 0.35, momentum6m: 0.2, momentum3m: 0.12,
      trend50_200: 0.18, priceVs200: 0.1, trendPersistence: 0.05,
    },
  },
  quality: {
    label: 'Quality & Persistence',
    members: {
      riskAdjusted: 0.3, sortino: 0.2, calmar: 0.2,
      consistency: 0.15, statisticalConfidence: 0.15,
    },
  },
  risk: {
    label: 'Risk & Tail Safety',
    members: {
      lowVolatility: 0.25, drawdownResilience: 0.25, tailSafety: 0.2,
      ulcerSafety: 0.2, skewPreference: 0.1,
    },
  },
  value: {
    label: 'Valuation & Mean Reversion',
    members: { valueProxy: 0.4, drawdownValue: 0.25, reversal1m: 0.2, distanceFrom52wHigh: 0.15 },
  },
  diversification: {
    label: 'Diversification & Alpha',
    members: {
      alpha: 0.3, informationRatio: 0.25, diversification: 0.2,
      downsideProtection: 0.15, captureSpread: 0.1,
    },
  },
};

/**
 * Builds the full cross-sectional factor panel.
 * @returns {{ byName: Record<string, number[]>, families: Record<string, number[]>, raw: object[] }}
 */
export function buildFactorPanel(candidates) {
  const raws = candidates.map((c) => c.rawFactors);
  const names = new Set();
  for (const r of raws) for (const k of Object.keys(r)) names.add(k);

  const byName = {};
  for (const name of names) {
    byName[name] = zScore(raws.map((r) => r[name]));
  }

  const families = {};
  for (const [famKey, fam] of Object.entries(FACTOR_FAMILIES)) {
    const scores = candidates.map((_, i) => {
      let acc = 0;
      let wsum = 0;
      for (const [member, w] of Object.entries(fam.members)) {
        if (!byName[member]) continue;
        acc += w * byName[member][i];
        wsum += w;
      }
      return wsum > EPS ? acc / wsum : 0;
    });
    // Re-standardise so families are on a common scale before the committee
    // starts weighting them against each other.
    families[famKey] = zScore(scores, { winsor: 0.02, clip: 2.5 });
  }

  return { byName, families, raw: raws };
}
