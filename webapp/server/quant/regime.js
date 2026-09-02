// Market regime detection. The same candidate deserves a different weight in a
// quiet uptrend than in a volatility spike, and a recommendation engine that
// ignores the state of the market is just curve-fitting the last five years.

import { mean, stdev, quantile, clamp, EPS } from './mathx.js';
import { TRADING_DAYS } from './series.js';
import { annualisedVol, maxDrawdown, drawdownSeries } from './metrics.js';

export const REGIMES = {
  EXPANSION: 'expansion',
  NEUTRAL: 'neutral',
  STRESS: 'stress',
};

/**
 * Classifies the benchmark's current state from trend, realised volatility
 * versus its own history, and current drawdown.
 */
/** English ordinal suffix, so the copy reads "53rd" rather than "53th". */
function ordinal(n) {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] ?? 'th'}`;
}

export function detectRegime(closes, returns) {
  if (closes.length < 210 || returns.length < 130) {
    return {
      regime: REGIMES.NEUTRAL,
      confidence: 0.2,
      reason: 'Insufficient benchmark history for a reliable regime read; defaulting to neutral.',
      signals: {},
    };
  }
  const n = closes.length;
  const sma = (win) => {
    let acc = 0;
    for (let i = n - win; i < n; i++) acc += closes[i];
    return acc / win;
  };
  const sma50 = sma(50);
  const sma200 = sma(200);
  const last = closes[n - 1];

  const vol3m = annualisedVol(returns.slice(-63), TRADING_DAYS);
  const volLong = annualisedVol(returns, TRADING_DAYS);
  const volRatio = volLong > EPS ? vol3m / volLong : 1;

  // Percentile of current 3-month vol within the history of 3-month vols.
  const rollingVols = [];
  for (let end = 63; end <= returns.length; end += 5) {
    rollingVols.push(annualisedVol(returns.slice(end - 63, end), TRADING_DAYS));
  }
  const volPercentile = rollingVols.length
    ? rollingVols.filter((v) => v <= vol3m).length / rollingVols.length
    : 0.5;

  const dd = drawdownSeries(returns);
  const currentDD = dd[dd.length - 1] ?? 0;
  const trendUp = sma50 > sma200;
  const aboveTrend = last > sma200;

  const signals = {
    goldenCross: trendUp,
    priceAboveTrend: aboveTrend,
    vol3m,
    volLongRun: volLong,
    volRatio,
    volPercentile,
    currentDrawdown: currentDD,
    momentum6m: n > 126 && closes[n - 127] > 0 ? last / closes[n - 127] - 1 : NaN,
  };

  // Score in [-1, 1]: positive = risk-on.
  let score = 0;
  score += trendUp ? 0.3 : -0.3;
  score += aboveTrend ? 0.2 : -0.2;
  score += volPercentile > 0.85 ? -0.3 : volPercentile < 0.4 ? 0.2 : 0;
  score += currentDD < -0.15 ? -0.25 : currentDD > -0.05 ? 0.15 : 0;
  score = clamp(score, -1, 1);

  let regime = REGIMES.NEUTRAL;
  if (score >= 0.35) regime = REGIMES.EXPANSION;
  else if (score <= -0.25) regime = REGIMES.STRESS;

  const reason = regime === REGIMES.EXPANSION
    ? `Benchmark is above its 200-day average with ${trendUp ? 'a positive 50/200 trend' : 'a mixed trend'} and volatility in the ${ordinal(volPercentile * 100)} percentile — a risk-on backdrop.`
    : regime === REGIMES.STRESS
      ? `Benchmark is ${currentDD < -0.1 ? `${(currentDD * 100).toFixed(1)}% below its high` : 'below trend'} with volatility in the ${ordinal(volPercentile * 100)} percentile — a defensive backdrop.`
      : `Benchmark signals are mixed (trend ${trendUp ? 'positive' : 'negative'}, volatility ${ordinal(volPercentile * 100)} percentile) — no strong directional read.`;

  return { regime, score, confidence: clamp(Math.abs(score) + 0.25, 0, 1), reason, signals };
}

/**
 * Regime-conditional tilts applied to the committee's factor weights. In
 * stress the risk seat gets louder; in expansion momentum earns more of a say.
 */
export function regimeTilts(regime) {
  switch (regime) {
    case REGIMES.EXPANSION:
      return { momentum: 1.2, quality: 1.0, risk: 0.85, value: 0.9, diversification: 1.0 };
    case REGIMES.STRESS:
      return { momentum: 0.7, quality: 1.15, risk: 1.35, value: 1.1, diversification: 1.2 };
    default:
      return { momentum: 1.0, quality: 1.0, risk: 1.0, value: 1.0, diversification: 1.0 };
  }
}
