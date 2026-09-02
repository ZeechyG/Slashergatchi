// End-to-end analysis. Reads the supplied URLs, turns them into candidates,
// prices them, runs the committee, builds a portfolio, and stress-tests the
// result. Emits progress events throughout so a long run stays legible.

import { fetchUrl, vetUrl } from './ingest/fetcher.js';
import { htmlToText, extractMetadata } from './ingest/html.js';
import { isYouTube, fetchYouTube } from './ingest/youtube.js';
import { analyseDocument, aggregateEvidence } from './ingest/extract.js';
import { getManySeries, MIN_OBSERVATIONS, SOURCE_LABELS } from './data/marketdata.js';
import { classify, describe, isSingleName, ASSET_CLASS_LABELS } from './data/universe.js';

import { alignSeries, simpleReturns, TRADING_DAYS, yearsSpanned } from './quant/series.js';
import { metricSheet } from './quant/metrics.js';
import { marketModel, factorModel, correlationStability } from './quant/regression.js';
import { rawFactors, buildFactorPanel } from './quant/factors.js';
import { detectRegime } from './quant/regime.js';
import { runCommittee, writeThesis, evaluateVetoes, RISK_PROFILES, SEATS } from './quant/committee.js';
import {
  shrinkCovariance, correlationMatrix, maxSharpeWeights, minVarianceWeights,
  riskParityWeights, hrpWeights, blendAllocations, riskContributions,
  portfolioVol, diversificationRatio, effectiveBets, kellyFraction,
} from './quant/portfolio.js';
import { simulate, equalWeightBaseline, walkForward, monteCarlo, compare } from './quant/backtest.js';
import { mean, sum, clamp, correlation, EPS } from './quant/mathx.js';

export const DEFAULTS = {
  benchmark: 'SPY',
  riskProfile: 'balanced',
  maxPositions: 8,
  horizonYears: 5,
  capital: 10000,
  rf: 0.042,
  allowSynthetic: false,
  costBps: 10,
};

/** Factor proxies used for the multi-asset attribution, when available. */
const FACTOR_PROXIES = { equity: 'SPY', bonds: 'IEF', gold: 'GLD', smallCap: 'IWM' };

/**
 * Runs the whole analysis.
 * @param {string[]} urls
 * @param {object} options
 * @param {(event: object) => void} emit progress callback
 */
export async function analyse(urls, options = {}, emit = () => {}) {
  const opts = { ...DEFAULTS, ...options };
  const profile = RISK_PROFILES[opts.riskProfile] ?? RISK_PROFILES.balanced;
  const started = Date.now();
  const warnings = [];

  // ---- 1. Read the sources -------------------------------------------------
  emit({ stage: 'ingest', status: 'start', message: `Reading ${urls.length} source${urls.length === 1 ? '' : 's'}` });
  const documents = [];
  const failures = [];

  const results = await mapLimit(urls, 4, async (url) => {
    emit({ stage: 'ingest', status: 'progress', message: `Fetching ${shortUrl(url)}` });
    return readSource(url);
  });
  for (const r of results) {
    if (r.ok) documents.push(r.doc);
    else failures.push({ url: r.url, reason: r.reason });
  }

  // Pasted text is a first-class source: paywalled pages and PDFs are common
  // enough that refusing them would hollow out the tool.
  for (const extra of opts.pastedSources ?? []) {
    if ((extra.text ?? '').trim().length < 120) continue;
    documents.push({
      url: extra.url || 'pasted://source',
      title: extra.title || 'Pasted source material',
      kind: 'pasted',
      text: extra.text,
      published: extra.published ?? null,
      note: 'Supplied directly by the user rather than fetched.',
    });
  }
  emit({
    stage: 'ingest', status: 'done',
    message: `Read ${documents.length} source${documents.length === 1 ? '' : 's'} (${urls.length} URL${urls.length === 1 ? '' : 's'} supplied)`,
    detail: failures.map((f) => `${shortUrl(f.url)}: ${f.reason}`),
  });

  if (!documents.length) {
    return {
      ok: false,
      error: 'None of the supplied URLs could be read.',
      failures,
      elapsedMs: Date.now() - started,
    };
  }

  // ---- 2. Read each document like an analyst -------------------------------
  emit({ stage: 'analyse', status: 'start', message: 'Extracting instruments, sentiment and source quality' });
  const analyses = documents.map(analyseDocument);
  const evidence = aggregateEvidence(analyses);
  emit({
    stage: 'analyse', status: 'done',
    message: `Found ${evidence.length} distinct instrument${evidence.length === 1 ? '' : 's'} across ${analyses.length} documents`,
    detail: evidence.slice(0, 12).map((e) => `${e.symbol} (${e.sourceCount} source${e.sourceCount === 1 ? '' : 's'}, credibility ${(e.credibility * 100).toFixed(0)}%)`),
  });

  if (!evidence.length) {
    return {
      ok: false,
      error: 'No investable instruments could be identified in the supplied material.',
      documents: analyses,
      failures,
      elapsedMs: Date.now() - started,
    };
  }

  // ---- 3. Price everything -------------------------------------------------
  // Cap the universe so one link dump does not turn into 200 provider calls.
  const shortlist = evidence
    .filter((e) => e.known || e.extractionConfidence >= 0.9)
    .slice(0, Math.max(opts.maxPositions * 3, 18));
  const dropped = evidence.length - shortlist.length;
  if (dropped > 0) {
    warnings.push(`${dropped} lower-confidence mention${dropped === 1 ? '' : 's'} were not priced (unrecognised symbols or single weak references).`);
  }

  const needed = [...new Set([
    ...shortlist.map((e) => e.symbol),
    opts.benchmark,
    ...Object.values(FACTOR_PROXIES),
  ])];
  emit({ stage: 'prices', status: 'start', message: `Fetching price history for ${needed.length} symbols` });
  const seriesBySymbol = await getManySeries(needed, {
    allowSynthetic: opts.allowSynthetic,
    userSeries: opts.userSeries,
  }, (p) => emit({
    stage: 'prices', status: 'progress',
    message: `${p.symbol}: ${p.source ? SOURCE_LABELS[p.source] ?? p.source : 'unavailable'} (${p.done}/${p.total})`,
  }));

  const priced = {};
  const unpriced = [];
  for (const e of shortlist) {
    const s = seriesBySymbol[e.symbol];
    if (s?.closes?.length >= MIN_OBSERVATIONS) priced[e.symbol] = s;
    else unpriced.push({ symbol: e.symbol, reason: s?.error ?? 'insufficient history', attempts: s?.attempts ?? [] });
  }
  const bench = seriesBySymbol[opts.benchmark];
  const benchmarkAvailable = bench?.closes?.length >= MIN_OBSERVATIONS;
  if (!benchmarkAvailable) {
    warnings.push(`Benchmark ${opts.benchmark} could not be priced; benchmark-relative statistics (alpha, beta, capture) are unavailable.`);
  }

  emit({
    stage: 'prices', status: 'done',
    message: `Priced ${Object.keys(priced).length} of ${shortlist.length} candidates`,
    detail: unpriced.map((u) => `${u.symbol}: ${u.reason}`),
  });

  const sources = new Set(Object.values(priced).map((p) => p.source));
  const simulatedData = sources.has('synthetic');
  if (simulatedData) {
    warnings.push('SIMULATED PRICE DATA IS IN USE. Some or all series could not be retrieved from a real provider and were replaced with simulated history. Every number derived from them is illustrative only and must not be used to make an investment decision.');
  }

  if (!Object.keys(priced).length) {
    return {
      ok: false,
      error: 'No candidate could be priced, so no quantitative comparison is possible.',
      documents: analyses,
      evidence,
      unpriced,
      failures,
      warnings,
      elapsedMs: Date.now() - started,
    };
  }

  // ---- 4. Align and compute ------------------------------------------------
  emit({ stage: 'quant', status: 'start', message: 'Computing risk, return and factor exposures' });
  const alignSet = { ...priced };
  if (benchmarkAvailable) alignSet[`__BENCH__${opts.benchmark}`] = bench;
  for (const [name, sym] of Object.entries(FACTOR_PROXIES)) {
    if (seriesBySymbol[sym]?.closes?.length >= MIN_OBSERVATIONS) alignSet[`__FACTOR__${name}`] = seriesBySymbol[sym];
  }

  const aligned = alignSeries(alignSet, 180);
  if (aligned.dropped.length) {
    const dropped = aligned.dropped.filter((d) => !d.startsWith('__'));
    if (dropped.length) {
      warnings.push(`${dropped.join(', ')} ${dropped.length === 1 ? 'was' : 'were'} excluded: too little overlapping history with the rest of the candidates to estimate correlations honestly.`);
      for (const d of dropped) unpriced.push({ symbol: d, reason: 'insufficient overlapping history' });
    }
  }

  const symbols = aligned.symbols.filter((s) => !s.startsWith('__'));
  if (!symbols.length) {
    return {
      ok: false,
      error: 'Candidates had no overlapping price history, so they cannot be compared.',
      documents: analyses, evidence, failures, warnings, elapsedMs: Date.now() - started,
    };
  }

  const returnsBySymbol = {};
  for (const s of aligned.symbols) returnsBySymbol[s] = simpleReturns(aligned.closes[s]);
  const benchKey = `__BENCH__${opts.benchmark}`;
  const benchReturns = benchmarkAvailable && returnsBySymbol[benchKey] ? returnsBySymbol[benchKey] : null;

  // Number of names considered, used to deflate the Sharpe ratios for the
  // selection bias inherent in analysing a hand-picked list.
  const trials = Math.max(1, evidence.length);

  // Cross-asset factor proxies, used to attribute each candidate's return to
  // the exposures it is really carrying rather than to skill.
  const factorReturns = {};
  for (const name of Object.keys(FACTOR_PROXIES)) {
    const key = `__FACTOR__${name}`;
    if (returnsBySymbol[key]?.length) factorReturns[name] = returnsBySymbol[key];
  }

  const candidates = symbols.map((sym) => {
    const closes = aligned.closes[sym];
    const rets = returnsBySymbol[sym];
    const metrics = metricSheet(rets, { periodsPerYear: TRADING_DAYS, rf: opts.rf, trials });
    const market = benchReturns ? marketModel(rets, benchReturns, { periodsPerYear: TRADING_DAYS, rf: opts.rf }) : null;
    const corrStability = benchReturns ? correlationStability(rets, benchReturns) : null;
    // Exclude a candidate from its own factor set, or it explains itself.
    const ownProxy = Object.entries(FACTOR_PROXIES).find(([, s2]) => s2 === sym)?.[0];
    const usableFactors = Object.fromEntries(
      Object.entries(factorReturns).filter(([k]) => k !== ownProxy),
    );
    const factors = Object.keys(usableFactors).length
      ? factorModel(rets, usableFactors, { periodsPerYear: TRADING_DAYS, rf: opts.rf })
      : null;
    const ev = evidence.find((e) => e.symbol === sym);
    const lastDate = aligned.dates[aligned.dates.length - 1];
    const dataAgeDays = Math.round((Date.now() - Date.parse(`${lastDate}T00:00:00Z`)) / 86400000);

    return {
      symbol: sym,
      name: describe(sym),
      assetClass: classify(sym),
      assetClassLabel: ASSET_CLASS_LABELS[classify(sym)] ?? 'Unclassified',
      singleName: isSingleName(sym),
      dataSource: priced[sym].source,
      dataSourceLabel: SOURCE_LABELS[priced[sym].source] ?? priced[sym].source,
      simulated: priced[sym].source === 'synthetic',
      firstDate: aligned.dates[0],
      lastDate,
      dataAgeDays,
      closes,
      returns: rets,
      metrics,
      market,
      factors,
      corrStability,
      evidence: ev,
      rawFactors: rawFactors(closes, rets, metrics, market),
    };
  });

  const panel = buildFactorPanel(candidates);
  const regime = benchmarkAvailable
    ? detectRegime(aligned.closes[benchKey], benchReturns)
    : { regime: 'neutral', confidence: 0, reason: 'No benchmark series available for a regime read.', signals: {} };
  emit({ stage: 'quant', status: 'done', message: `Regime: ${regime.regime}. ${regime.reason}` });

  // ---- 5. Committee --------------------------------------------------------
  emit({ stage: 'committee', status: 'start', message: 'Convening the investment committee' });
  for (const c of candidates) c.vetoes = evaluateVetoes(c);
  const scored = runCommittee(candidates, panel, { regime: regime.regime, riskProfile: opts.riskProfile })
    .map((c) => ({ ...c, thesis: writeThesis(c, { benchmark: opts.benchmark }) }))
    .sort((a, b) => b.consensus - a.consensus);
  emit({
    stage: 'committee', status: 'done',
    message: `${scored.filter((c) => !c.blocked).length} of ${scored.length} candidates cleared risk limits`,
    detail: scored.slice(0, 8).map((c) => `${c.symbol}: ${c.recommendation} (${c.consensus.toFixed(2)})`),
  });

  // ---- 6. Portfolio construction ------------------------------------------
  emit({ stage: 'portfolio', status: 'start', message: 'Constructing the allocation' });
  const eligible = scored.filter((c) => !c.blocked && c.consensus > 0.05).slice(0, opts.maxPositions);
  const selected = eligible.length >= 2
    ? eligible
    : scored.filter((c) => !c.blocked).slice(0, Math.max(2, Math.min(opts.maxPositions, scored.filter((c) => !c.blocked).length)));

  // Near-identical exposures are the same bet wearing two names. Holding both
  // adds cost and concentration while looking like diversification, so the
  // lower-scoring twin is dropped and the reason is reported.
  const { kept: deduped, redundant } = pruneRedundant(selected, returnsBySymbol, 0.97);
  for (const r of redundant) {
    warnings.push(`${r.dropped} was excluded as redundant: it is ${(r.correlation * 100).toFixed(1)}% correlated with ${r.keptSymbol}, which scored higher. Holding both would be one bet under two names.`);
  }

  let portfolio = null;
  if (deduped.length >= 1) {
    portfolio = buildPortfolio(deduped, returnsBySymbol, profile, opts, regime);
  }
  emit({
    stage: 'portfolio', status: 'done',
    message: portfolio
      ? `Allocation across ${portfolio.holdings.length} position${portfolio.holdings.length === 1 ? '' : 's'} at ${(portfolio.expected.volatility * 100).toFixed(1)}% expected volatility`
      : 'No candidate cleared the risk limits, so no allocation was produced.',
  });

  // ---- 7. Validation -------------------------------------------------------
  let validation = null;
  if (portfolio && portfolio.holdings.length >= 1) {
    emit({ stage: 'validate', status: 'start', message: 'Backtesting and stress-testing the allocation' });
    validation = validatePortfolio(portfolio, deduped, returnsBySymbol, benchReturns, opts, profile, regime);
    emit({
      stage: 'validate', status: 'done',
      message: validation.backtest
        ? `In-sample ${(validation.backtest.metrics.cagr * 100).toFixed(1)}% CAGR, Sharpe ${validation.backtest.metrics.sharpe.toFixed(2)}, worst drawdown ${(validation.backtest.metrics.maxDrawdown * 100).toFixed(1)}%`
        : 'Backtest unavailable.',
    });
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    options: { ...opts, userSeries: undefined },
    profile: { key: opts.riskProfile, ...profile },
    regime,
    documents: analyses,
    failures,
    evidence,
    unpriced,
    candidates: scored,
    panel: { families: panel.families, symbols: scored.map((c) => c.symbol) },
    portfolio,
    redundant,
    validation,
    warnings,
    simulatedData,
    seats: SEATS,
    dataProvenance: summariseProvenance(priced, seriesBySymbol, opts),
  };
}

// ---------------------------------------------------------------------------

/** Fetches and normalises one source into a document. */
async function readSource(url) {
  const vetted = await vetUrl(url);
  if (!vetted.ok) return { ok: false, url, reason: vetted.reason };

  if (isYouTube(url)) {
    const yt = await fetchYouTube(url);
    if (!yt.ok) return { ok: false, url, reason: yt.reason };
    const text = [yt.title, yt.description, yt.transcript].filter(Boolean).join('\n\n');
    if (!text.trim()) return { ok: false, url, reason: 'YouTube page yielded no readable text.' };
    return {
      ok: true,
      doc: {
        url, title: yt.title ?? url, kind: 'youtube', text,
        published: null,
        note: yt.note ?? `Transcript source: ${yt.transcriptSource}.`,
        channel: yt.channel,
      },
    };
  }

  const res = await fetchUrl(url);
  if (!res.ok) return { ok: false, url, reason: res.reason };

  const ct = res.contentType;
  if (ct.includes('application/pdf')) {
    return { ok: false, url, reason: 'PDF sources are not parsed by this tool; supply an HTML version or paste the text.' };
  }
  if (ct.includes('json')) {
    return { ok: true, doc: { url, title: url, kind: 'data', text: res.body.slice(0, 200000), published: null } };
  }
  if (ct.includes('text/plain') || ct.includes('csv')) {
    return { ok: true, doc: { url, title: url, kind: 'text', text: res.body, published: null } };
  }

  const meta = extractMetadata(res.body);
  const text = htmlToText(res.body);
  if (text.length < 200) {
    return { ok: false, url, reason: 'Page had almost no readable text (likely JavaScript-rendered or paywalled).' };
  }
  return {
    ok: true,
    doc: {
      url,
      title: meta.ogTitle || meta.title || url,
      kind: 'article',
      text,
      published: meta.published ?? null,
      author: meta.author ?? null,
      note: res.truncated ? 'Page was truncated at the size limit; later sections were not analysed.' : null,
    },
  };
}

/**
 * Drops candidates that are effectively the same exposure as a higher-scoring
 * one already in the list. Correlation alone is the test: two funds tracking
 * the same index correlate above 0.97 whatever their names suggest.
 */
function pruneRedundant(selected, returnsBySymbol, threshold) {
  const kept = [];
  const redundant = [];
  for (const c of selected) {
    const twin = kept.find((k) => {
      const r = correlationBetween(returnsBySymbol[k.symbol], returnsBySymbol[c.symbol]);
      return Number.isFinite(r) && r >= threshold;
    });
    if (twin) {
      redundant.push({
        dropped: c.symbol,
        keptSymbol: twin.symbol,
        correlation: correlationBetween(returnsBySymbol[twin.symbol], returnsBySymbol[c.symbol]),
      });
    } else {
      kept.push(c);
    }
  }
  return { kept, redundant };
}

function correlationBetween(a, b) {
  if (!a?.length || !b?.length) return NaN;
  const n = Math.min(a.length, b.length);
  return correlation(a.slice(-n), b.slice(-n));
}

/** Builds the allocation from the selected candidates. */
function buildPortfolio(selected, returnsBySymbol, profile, opts, regime) {
  const symbols = selected.map((c) => c.symbol);
  const rets = {};
  for (const s of symbols) rets[s] = returnsBySymbol[s];

  const { sigma: dailyCov, delta } = shrinkCovariance(rets, symbols);
  const sigma = dailyCov.map((row) => row.map((v) => v * TRADING_DAYS));
  const corr = correlationMatrix(rets, symbols);

  // Expected returns are the weakest input in any optimiser, so they are built
  // conservatively: the historical mean is shrunk hard toward the cross-
  // sectional average and then tilted by the committee's conviction-weighted
  // view rather than being taken at face value.
  const histMu = symbols.map((s) => mean(rets[s]) * TRADING_DAYS);
  const grandMean = mean(histMu);
  const shrunkMu = histMu.map((m) => 0.35 * m + 0.65 * grandMean);
  const mu = shrunkMu.map((m, i) => {
    const c = selected[i];
    const tilt = 0.02 * c.consensus * c.conviction;   // at most ~±60bp of view
    return m + tilt;
  });

  const maxWeight = Math.min(profile.maxWeight, symbols.length === 1 ? 1 : Math.max(1 / symbols.length, profile.maxWeight));
  const minWeight = 0;
  const solutions = {
    maxSharpe: maxSharpeWeights(mu, sigma, { minWeight, maxWeight, rf: opts.rf }),
    riskParity: riskParityWeights(sigma, { minWeight, maxWeight }),
    hrp: hrpWeights(sigma, { minWeight, maxWeight }),
    minVariance: minVarianceWeights(sigma, { minWeight, maxWeight }),
  };

  // Conviction tilt: scale the blended weights by each name's committee score
  // before renormalising, so the process expresses a view without letting the
  // view override the risk model.
  const blended = blendAllocations(solutions, profile.optimiserBlend, { minWeight, maxWeight });
  const convictionMultipliers = selected.map((c) => clamp(1 + 0.35 * c.consensus * c.conviction, 0.5, 1.6));
  const tilted = blended.map((w, i) => w * convictionMultipliers[i]);
  const tiltSum = sum(tilted);
  let weights = tiltSum > EPS ? tilted.map((w) => w / tiltSum) : blended;
  // Re-apply the box constraint after tilting.
  weights = blendAllocations({ tilted: weights }, { tilted: 1 }, { minWeight, maxWeight });

  // Drop dust positions: a 0.4% holding is a rounding error, not a decision.
  const dustThreshold = 0.02;
  const keep = weights.map((w) => w >= dustThreshold);
  if (keep.some((k) => !k) && keep.filter(Boolean).length >= 1) {
    const cleaned = weights.map((w, i) => (keep[i] ? w : 0));
    const s = sum(cleaned);
    weights = s > EPS ? cleaned.map((w) => w / s) : weights;
  }

  const grossVol = portfolioVol(weights, sigma);
  const grossReturn = sum(weights.map((w, i) => w * mu[i]));

  // Volatility targeting: hold cash rather than force the risky sleeve to be
  // something it is not. Cash is a position, and at current bill yields it is
  // a real one.
  const volTarget = profile.maxPortfolioVol;
  const volScale = grossVol > volTarget ? volTarget / grossVol : 1;
  const kelly = kellyFraction(grossReturn - opts.rf, grossVol, { fraction: profile.kellyFraction, cap: 1 });
  const riskyShare = clamp(Math.min(volScale, Math.max(kelly, 0.35)), 0.1, 1);
  const cashShare = 1 - riskyShare;

  const rc = riskContributions(weights, sigma);
  const holdings = selected
    .map((c, i) => ({
      symbol: c.symbol,
      name: c.name,
      assetClass: c.assetClass,
      assetClassLabel: c.assetClassLabel,
      weightOfRisky: weights[i],
      weight: weights[i] * riskyShare,
      riskContribution: rc[i],
      dollars: weights[i] * riskyShare * opts.capital,
      consensus: c.consensus,
      conviction: c.conviction,
      recommendation: c.recommendation,
      expectedReturn: mu[i],
      volatility: Math.sqrt(Math.max(0, sigma[i][i])),
      simulated: c.simulated,
    }))
    .filter((h) => h.weightOfRisky > 0.0001)
    .sort((a, b) => b.weight - a.weight);

  return {
    holdings,
    cash: {
      weight: cashShare,
      dollars: cashShare * opts.capital,
      rationale: cashShare > 0.02
        ? `${(cashShare * 100).toFixed(0)}% is held in cash or T-bills: the risky sleeve on its own runs ${(grossVol * 100).toFixed(1)}% volatility against a ${(volTarget * 100).toFixed(0)}% budget for a ${profile.label.toLowerCase()} mandate, and fractional-Kelly sizing on the estimated edge supports ${(kelly * 100).toFixed(0)}% risky exposure.`
        : 'The risky sleeve fits inside the volatility budget, so no cash buffer is required beyond what you choose to hold.',
    },
    expected: {
      returnGross: grossReturn,
      return: grossReturn * riskyShare + opts.rf * cashShare,
      volatilityGross: grossVol,
      volatility: grossVol * riskyShare,
      sharpe: grossVol > EPS ? (grossReturn - opts.rf) / grossVol : NaN,
      riskyShare,
      kelly,
    },
    diagnostics: {
      shrinkageIntensity: delta,
      diversificationRatio: diversificationRatio(weights, sigma),
      effectiveBets: effectiveBets(weights),
      averageCorrelation: averageOffDiagonal(corr),
      maxWeightConstraint: maxWeight,
      volatilityTarget: volTarget,
    },
    matrices: { correlation: corr, symbols },
    solutions: Object.fromEntries(Object.entries(solutions).map(([k, v]) => [k, v])),
    blend: profile.optimiserBlend,
    regime: regime.regime,
  };
}

/** Backtest, walk-forward and Monte Carlo for the recommended weights. */
function validatePortfolio(portfolio, selected, returnsBySymbol, benchReturns, opts, profile) {
  const symbols = portfolio.holdings.map((h) => h.symbol);
  const weights = portfolio.holdings.map((h) => h.weightOfRisky);
  const wsum = sum(weights);
  const normalised = wsum > EPS ? weights.map((w) => w / wsum) : weights;
  const rets = {};
  for (const s of symbols) rets[s] = returnsBySymbol[s];

  const backtest = simulate(normalised, symbols, rets, { rebalanceEvery: 21, costBps: opts.costBps });
  const equalWeight = equalWeightBaseline(symbols, rets, { rebalanceEvery: 21, costBps: opts.costBps });

  // Refit the same construction process on each in-sample window.
  const wf = walkForward(symbols, rets, (inSample, syms) => {
    const { sigma: dc } = shrinkCovariance(inSample, syms);
    const s = dc.map((row) => row.map((v) => v * TRADING_DAYS));
    const histMu = syms.map((k) => mean(inSample[k]) * TRADING_DAYS);
    const gm = mean(histMu);
    const mu = histMu.map((m) => 0.35 * m + 0.65 * gm);
    return blendAllocations({
      maxSharpe: maxSharpeWeights(mu, s, { maxWeight: profile.maxWeight, rf: opts.rf, steps: 800 }),
      riskParity: riskParityWeights(s, { maxWeight: profile.maxWeight }),
      hrp: hrpWeights(s, { maxWeight: profile.maxWeight }),
      minVariance: minVarianceWeights(s, { maxWeight: profile.maxWeight, steps: 600 }),
    }, profile.optimiserBlend, { maxWeight: profile.maxWeight });
  }, { costBps: opts.costBps });

  const runs = { recommended: backtest, equalWeight };
  if (benchReturns) {
    runs.benchmark = simulate([1], ['BENCH'], { BENCH: benchReturns }, { rebalanceEvery: 0, costBps: 0 });
  }

  return {
    backtest,
    equalWeight,
    walkForward: wf,
    comparison: compare(runs),
    monteCarlo: backtest ? monteCarlo(backtest.returns, { horizonYears: opts.horizonYears }) : null,
    note: 'The backtest applies the recommended weights to the same history used to choose them, so it is descriptive, not predictive. The walk-forward figures re-fit the process on past data only and are the more honest read.',
  };
}

function averageOffDiagonal(matrix) {
  const vals = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) vals.push(matrix[i][j]);
  }
  return vals.length ? mean(vals) : NaN;
}

function summariseProvenance(priced, all, opts) {
  const counts = {};
  for (const p of Object.values(priced)) counts[p.source] = (counts[p.source] ?? 0) + 1;
  return {
    bySource: Object.entries(counts).map(([source, count]) => ({
      source, count, label: SOURCE_LABELS[source] ?? source,
    })),
    benchmark: {
      symbol: opts.benchmark,
      source: all[opts.benchmark]?.source ?? null,
      label: SOURCE_LABELS[all[opts.benchmark]?.source] ?? 'unavailable',
    },
  };
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.length > 24 ? `${u.pathname.slice(0, 24)}…` : u.pathname}`;
  } catch {
    return url.slice(0, 48);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
