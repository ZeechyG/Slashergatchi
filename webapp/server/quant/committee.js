// The investment committee. Each seat is a different professional mandate with
// its own factor weights, its own hard limits, and its own veto. A single
// blended score hides disagreement; this keeps the disagreement visible,
// because dispersion across seats is itself information about conviction.

import { mean, stdev, clamp, sum, EPS } from './mathx.js';
import { regimeTilts } from './regime.js';

/**
 * Seats on the committee.
 *  - `weights` are over factor families (see factors.js).
 *  - `vetoes` are hard risk limits; a triggered veto caps the seat's score and
 *    is surfaced verbatim in the output rather than being averaged away.
 */
export const SEATS = {
  systematic: {
    name: 'Systematic / Quant PM',
    mandate: 'Trades persistent, statistically testable risk premia. Trusts the cross-section, distrusts stories.',
    vote: 0.24,
    weights: { momentum: 0.42, quality: 0.28, risk: 0.12, value: 0.05, diversification: 0.13 },
  },
  fundamental: {
    name: 'Fundamental / Value PM',
    mandate: 'Buys assets priced below what their cash flows justify. Will not pay up for momentum.',
    vote: 0.2,
    weights: { momentum: 0.05, quality: 0.32, risk: 0.15, value: 0.38, diversification: 0.1 },
  },
  risk: {
    name: 'Chief Risk Officer',
    mandate: 'Owns the downside. Sizes to what the portfolio can survive, not what it might earn.',
    vote: 0.22,
    weights: { momentum: 0.05, quality: 0.2, risk: 0.55, value: 0.05, diversification: 0.15 },
  },
  macro: {
    name: 'Macro / Cross-Asset Strategist',
    mandate: 'Thinks in regimes and correlations. Values what behaves differently from everything else you own.',
    vote: 0.18,
    weights: { momentum: 0.18, quality: 0.15, risk: 0.2, value: 0.12, diversification: 0.35 },
  },
  diligence: {
    name: 'Research Diligence Officer',
    mandate: 'Judges the source, not the ticker. Discounts anything that arrived with a sales pitch attached.',
    vote: 0.16,
    weights: { momentum: 0.1, quality: 0.3, risk: 0.25, value: 0.15, diversification: 0.2 },
  },
};

/** Risk-tolerance profiles shift both the seat votes and the blend of optimisers. */
export const RISK_PROFILES = {
  conservative: {
    label: 'Conservative',
    seatTilt: { systematic: 0.8, fundamental: 1.05, risk: 1.5, macro: 1.1, diligence: 1.15 },
    optimiserBlend: { riskParity: 0.35, hrp: 0.25, minVariance: 0.28, maxSharpe: 0.12 },
    maxWeight: 0.3,
    maxPortfolioVol: 0.11,
    kellyFraction: 0.2,
  },
  balanced: {
    label: 'Balanced',
    seatTilt: { systematic: 1.0, fundamental: 1.0, risk: 1.0, macro: 1.0, diligence: 1.0 },
    optimiserBlend: { riskParity: 0.28, hrp: 0.24, minVariance: 0.14, maxSharpe: 0.34 },
    maxWeight: 0.4,
    maxPortfolioVol: 0.16,
    kellyFraction: 0.35,
  },
  aggressive: {
    label: 'Aggressive',
    seatTilt: { systematic: 1.35, fundamental: 0.95, risk: 0.75, macro: 0.95, diligence: 0.9 },
    optimiserBlend: { riskParity: 0.16, hrp: 0.18, minVariance: 0.06, maxSharpe: 0.6 },
    maxWeight: 0.5,
    maxPortfolioVol: 0.24,
    kellyFraction: 0.5,
  },
};

/**
 * Hard limits evaluated per candidate. Each returns a reason string when it
 * fires. These are deliberately blunt: a risk desk's job is to say no in
 * language nobody can misread.
 */
const VETO_RULES = [
  {
    id: 'insufficient-history',
    seat: 'risk',
    severity: 'blocking',
    test: (c) => c.metrics.observations < 180,
    reason: (c) => `Only ${c.metrics.observations} observations of price history — too short to estimate risk with any confidence.`,
  },
  {
    id: 'catastrophic-drawdown',
    seat: 'risk',
    severity: 'blocking',
    test: (c) => Number.isFinite(c.metrics.maxDrawdown) && c.metrics.maxDrawdown < -0.7,
    reason: (c) => `Peak-to-trough loss of ${(c.metrics.maxDrawdown * 100).toFixed(0)}% in the sample. A drawdown that size requires a ${((1 / (1 + c.metrics.maxDrawdown) - 1) * 100).toFixed(0)}% gain just to break even.`,
  },
  {
    id: 'extreme-volatility',
    seat: 'risk',
    severity: 'warning',
    test: (c) => Number.isFinite(c.metrics.annualVol) && c.metrics.annualVol > 0.6,
    reason: (c) => `Annualised volatility of ${(c.metrics.annualVol * 100).toFixed(0)}% — position sizing, not conviction, will determine the outcome here.`,
  },
  {
    id: 'fat-left-tail',
    seat: 'risk',
    severity: 'warning',
    test: (c) => Number.isFinite(c.metrics.cvar95) && Number.isFinite(c.metrics.var95) &&
      c.metrics.var95 > EPS && c.metrics.cvar95 / c.metrics.var95 > 1.9,
    reason: (c) => `Expected shortfall is ${(c.metrics.cvar95 / c.metrics.var95).toFixed(1)}x the 95% VaR: losses beyond the threshold get much worse, fast.`,
  },
  {
    id: 'no-statistical-edge',
    seat: 'systematic',
    severity: 'warning',
    test: (c) => Number.isFinite(c.metrics.psr) && c.metrics.psr < 0.5,
    reason: (c) => `Probabilistic Sharpe of ${(c.metrics.psr * 100).toFixed(0)}% — the track record is not long or clean enough to distinguish this from luck.`,
  },
  {
    id: 'negative-expectancy',
    seat: 'fundamental',
    severity: 'blocking',
    test: (c) => Number.isFinite(c.metrics.cagr) && c.metrics.cagr < -0.15 &&
      Number.isFinite(c.metrics.momentum12_1 ?? c.rawFactors?.momentum12_1) &&
      (c.rawFactors?.momentum12_1 ?? 0) < 0,
    reason: (c) => `Compounding at ${(c.metrics.cagr * 100).toFixed(1)}% a year with negative 12-month momentum — the trend and the arithmetic both point down.`,
  },
  {
    id: 'promotional-source',
    seat: 'diligence',
    severity: 'blocking',
    test: (c) => (c.evidence?.hypeScore ?? 0) > 0.65,
    reason: (c) => `Source material scores ${((c.evidence.hypeScore) * 100).toFixed(0)}/100 on promotional language${c.evidence.redFlags?.length ? ` (${c.evidence.redFlags.slice(0, 2).join('; ')})` : ''}. Treated as an advertisement until proven otherwise.`,
  },
  {
    id: 'single-source',
    seat: 'diligence',
    severity: 'warning',
    test: (c) => (c.evidence?.sourceCount ?? 0) <= 1 && (c.evidence?.credibility ?? 0.5) < 0.5,
    reason: () => 'Mentioned by a single low-credibility source with no corroboration elsewhere in the supplied material.',
  },
  {
    id: 'crowded-with-benchmark',
    seat: 'macro',
    severity: 'warning',
    test: (c) => Number.isFinite(c.market?.correlation) && c.market.correlation > 0.93 &&
      Number.isFinite(c.market?.alphaAnnual) && c.market.alphaAnnual < 0.01,
    reason: (c) => `${(c.market.correlation * 100).toFixed(0)}% correlated to the benchmark with no measurable alpha — you are paying for exposure the index already gives you.`,
  },
  {
    id: 'stale-data',
    seat: 'diligence',
    severity: 'warning',
    test: (c) => (c.dataAgeDays ?? 0) > 21,
    reason: (c) => `Latest price observation is ${c.dataAgeDays} days old; conclusions may not reflect current market conditions.`,
  },
];

/** Evaluates every veto rule against a candidate. */
export function evaluateVetoes(candidate) {
  const fired = [];
  for (const rule of VETO_RULES) {
    let hit = false;
    try {
      hit = !!rule.test(candidate);
    } catch {
      hit = false;
    }
    if (hit) {
      fired.push({
        id: rule.id,
        seat: rule.seat,
        seatName: SEATS[rule.seat]?.name ?? rule.seat,
        severity: rule.severity,
        reason: rule.reason(candidate),
      });
    }
  }
  return fired;
}

/**
 * One seat's view of one candidate: a factor-weighted score in roughly
 * [-3, 3], the conviction behind it, and the reasoning in plain language.
 */
function seatVote(seatKey, seat, candidate, familyScores, tilts, evidenceScore) {
  let score = 0;
  let wsum = 0;
  const contributions = [];
  for (const [family, w] of Object.entries(seat.weights)) {
    const tilted = w * (tilts[family] ?? 1);
    const fs = familyScores[family] ?? 0;
    score += tilted * fs;
    wsum += tilted;
    contributions.push({ family, weight: tilted, score: fs, contribution: tilted * fs });
  }
  score = wsum > EPS ? score / wsum : 0;

  // The diligence seat scores the source material, not just the price series.
  if (seatKey === 'diligence') {
    score = 0.45 * score + 0.55 * evidenceScore;
    contributions.push({
      family: 'sourceQuality', weight: 0.55, score: evidenceScore, contribution: 0.55 * evidenceScore,
    });
  }

  const vetoes = (candidate.vetoes ?? []).filter((v) => v.seat === seatKey);
  const blocking = vetoes.filter((v) => v.severity === 'blocking');
  const warnings = vetoes.filter((v) => v.severity === 'warning');
  if (blocking.length) score = Math.min(score, -1.5);
  else if (warnings.length) score -= 0.35 * warnings.length;

  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return {
    seat: seatKey,
    name: seat.name,
    mandate: seat.mandate,
    score: clamp(score, -3, 3),
    stance: score > 0.55 ? 'buy' : score < -0.55 ? 'avoid' : 'hold',
    drivers: contributions.slice(0, 3),
    vetoes,
  };
}

/**
 * Runs the whole committee over every candidate.
 *
 * @param candidates array of enriched candidate objects
 * @param panel factor panel from buildFactorPanel
 * @param opts.regime detected market regime
 * @param opts.riskProfile key of RISK_PROFILES
 */
export function runCommittee(candidates, panel, { regime = 'neutral', riskProfile = 'balanced' } = {}) {
  const tilts = regimeTilts(regime);
  const profile = RISK_PROFILES[riskProfile] ?? RISK_PROFILES.balanced;

  return candidates.map((candidate, i) => {
    const familyScores = {};
    for (const [fam, arr] of Object.entries(panel.families)) familyScores[fam] = arr[i] ?? 0;

    // Evidence score in z-like units: credible, non-promotional, corroborated
    // material earns a positive contribution; a hype pitch earns a negative one.
    const ev = candidate.evidence ?? {};
    const evidenceScore = clamp(
      1.6 * ((ev.credibility ?? 0.5) - 0.5) +
      0.9 * Math.tanh(((ev.sourceCount ?? 1) - 1) / 2) +
      0.8 * (ev.sentiment ?? 0) -
      2.2 * (ev.hypeScore ?? 0),
      -2.5, 2.5,
    );

    const votes = Object.entries(SEATS).map(([key, seat]) =>
      seatVote(key, seat, candidate, familyScores, tilts, evidenceScore));

    const voteWeights = votes.map((v) => SEATS[v.seat].vote * (profile.seatTilt[v.seat] ?? 1));
    const wTotal = sum(voteWeights);
    const consensus = wTotal > EPS
      ? sum(votes.map((v, k) => v.score * voteWeights[k])) / wTotal
      : 0;

    const scores = votes.map((v) => v.score);
    const dispersion = stdev(scores);
    const blocking = (candidate.vetoes ?? []).filter((v) => v.severity === 'blocking');

    // Conviction falls when the seats disagree, when the sample is short, and
    // when the statistical evidence is weak. It is not the same thing as the score.
    const historyConfidence = clamp((candidate.metrics.observations ?? 0) / 756, 0, 1);
    const statConfidence = Number.isFinite(candidate.metrics.psr) ? candidate.metrics.psr : 0.5;
    const conviction = clamp(
      0.45 * (1 - clamp(dispersion / 1.5, 0, 1)) +
      0.3 * historyConfidence +
      0.25 * statConfidence,
      0, 1,
    );

    return {
      ...candidate,
      familyScores,
      evidenceScore,
      votes,
      consensus: blocking.length ? Math.min(consensus, -1.2) : consensus,
      rawConsensus: consensus,
      dispersion,
      conviction,
      blocked: blocking.length > 0,
      recommendation: blocking.length
        ? 'reject'
        : consensus > 0.7 ? 'overweight'
          : consensus > 0.15 ? 'include'
            : consensus > -0.5 ? 'watch' : 'avoid',
    };
  });
}

/**
 * Turns a candidate's committee output into the paragraph a PM would actually
 * write in the investment memo.
 */
export function writeThesis(c, { benchmark = 'the benchmark' } = {}) {
  const m = c.metrics;
  const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');
  const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
  const lines = [];

  const bulls = c.votes.filter((v) => v.stance === 'buy').map((v) => v.name);
  const bears = c.votes.filter((v) => v.stance === 'avoid').map((v) => v.name);

  lines.push(
    `${c.symbol} compounded at ${pct(m.cagr)} a year with ${pct(m.annualVol)} volatility over ${num(m.years, 1)} years of data, a Sharpe of ${num(m.sharpe)} and a worst drawdown of ${pct(m.maxDrawdown)}.`,
  );

  if (c.market) {
    lines.push(
      `Against ${benchmark} it runs a beta of ${num(c.market.beta)} with ${pct(c.market.alphaAnnual)} annualised alpha (t = ${num(c.market.alphaTStat)}), capturing ${pct(c.market.upCapture, 0)} of up moves and ${pct(c.market.downCapture, 0)} of down moves.`,
    );
  }

  const strongest = Object.entries(c.familyScores).sort((a, b) => b[1] - a[1])[0];
  const weakest = Object.entries(c.familyScores).sort((a, b) => a[1] - b[1])[0];
  if (strongest && weakest) {
    lines.push(
      `Its strongest factor exposure is ${strongest[0]} (${strongest[1] > 0 ? '+' : ''}${num(strongest[1])}σ versus the other candidates); its weakest is ${weakest[0]} (${num(weakest[1])}σ).`,
    );
  }

  if (bulls.length && bears.length) {
    lines.push(`The committee is split: ${bulls.join(' and ')} argue for it, ${bears.join(' and ')} against, giving a dispersion of ${num(c.dispersion)} and correspondingly reduced conviction.`);
  } else if (bulls.length) {
    lines.push(`${bulls.join(', ')} back the position; no seat opposes it.`);
  } else if (bears.length) {
    lines.push(`${bears.join(', ')} oppose the position and no seat argues for it.`);
  } else {
    lines.push('No seat holds a strong view either way — this is a neutral-scoring candidate.');
  }

  if (Number.isFinite(m.psr)) {
    lines.push(
      m.psr > 0.9
        ? `The record is long and clean enough to take at face value (probabilistic Sharpe ${pct(m.psr, 0)}).`
        : `Treat the historical Sharpe with caution: probabilistic Sharpe is only ${pct(m.psr, 0)}, so the sample cannot rule out luck.`,
    );
  }

  const blocking = (c.vetoes ?? []).filter((v) => v.severity === 'blocking');
  if (blocking.length) {
    lines.push(`Rejected on a hard limit — ${blocking.map((v) => v.reason).join(' ')}`);
  }
  return lines.join(' ');
}
