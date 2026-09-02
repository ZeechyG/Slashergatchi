// Reads a fetched document the way a research analyst skims it: what is being
// recommended, how strongly, on what evidence, and how much of it is a pitch.

import { SENTIMENT, RED_FLAGS, CREDIBILITY_MARKERS, domainTier } from './lexicon.js';
import { KNOWN, NAME_TO_TICKER, TICKER_STOPWORDS, classify, describe } from '../data/universe.js';
import { clamp, mean } from '../quant/mathx.js';

/**
 * Finds instrument mentions and scores how confident we are in each one.
 * Confidence matters: "$NVDA" in a headline is a different signal from the
 * word "META" appearing mid-sentence.
 */
export function extractInstruments(text, { title = '' } = {}) {
  const found = new Map();
  const add = (symbol, confidence, evidence) => {
    const sym = symbol.toUpperCase().replace(/[^A-Z.\-]/g, '');
    if (!sym || sym.length > 6) return;
    if (TICKER_STOPWORDS.has(sym) && confidence < 0.9) return;
    const prev = found.get(sym);
    if (!prev) found.set(sym, { symbol: sym, confidence, mentions: 1, evidence: [evidence] });
    else {
      prev.mentions += 1;
      prev.confidence = Math.max(prev.confidence, confidence);
      if (prev.evidence.length < 4 && !prev.evidence.includes(evidence)) prev.evidence.push(evidence);
    }
  };

  const haystack = `${title}\n${text}`;

  // 1. Cashtags: unambiguous by construction.
  for (const m of haystack.matchAll(/\$([A-Z]{1,5})(?![A-Za-z0-9])/g)) {
    add(m[1], 0.95, contextOf(haystack, m.index));
  }

  // 2. Exchange-qualified tickers: "NASDAQ: AAPL", "NYSE:BRK.B", "(LSE: VOD)".
  for (const m of haystack.matchAll(/\b(?:NASDAQ|NYSE|NYSEARCA|AMEX|BATS|OTC|LSE|TSX|ASX)\s*[:\-]\s*([A-Z]{1,5}(?:[.\-][A-Z])?)\b/gi)) {
    add(m[1], 0.98, contextOf(haystack, m.index));
  }

  // 3. Parenthetical tickers next to a name: "Apple (AAPL)".
  for (const m of haystack.matchAll(/\(([A-Z]{2,5}(?:[.\-][A-Z])?)\)/g)) {
    const sym = m[1];
    add(sym, KNOWN[sym] ? 0.9 : 0.55, contextOf(haystack, m.index));
  }

  // 4. Bare tickers that are in our known universe.
  for (const m of haystack.matchAll(/\b([A-Z]{2,5})\b/g)) {
    if (KNOWN[m[1]]) add(m[1], 0.7, contextOf(haystack, m.index));
  }

  // 5. Company and asset names written out in prose.
  const lower = haystack.toLowerCase();
  for (const [name, ticker] of NAME_TO_TICKER) {
    if (name.length < 4) continue;
    const at = lower.indexOf(name);
    if (at !== -1) {
      const before = lower[at - 1] ?? ' ';
      const after = lower[at + name.length] ?? ' ';
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
        add(ticker, 0.75, contextOf(haystack, at));
      }
    }
  }

  return [...found.values()]
    .map((f) => ({
      ...f,
      name: describe(f.symbol),
      assetClass: classify(f.symbol),
      known: !!KNOWN[f.symbol],
      // Mentions in the title carry more weight than a passing reference.
      prominence: computeProminence(f, haystack, title),
    }))
    .sort((a, b) => b.confidence * b.prominence - a.confidence * a.prominence);
}

function computeProminence(f, haystack, title) {
  const inTitle = title.toUpperCase().includes(f.symbol) ? 0.4 : 0;
  const density = clamp(f.mentions / Math.max(1, haystack.length / 4000), 0, 1) * 0.4;
  const firstAt = haystack.toUpperCase().indexOf(f.symbol);
  const early = firstAt >= 0 && firstAt < haystack.length * 0.25 ? 0.2 : 0;
  return clamp(0.2 + inTitle + density + early, 0, 1);
}

function contextOf(text, index, span = 90) {
  const start = Math.max(0, index - span);
  const end = Math.min(text.length, index + span);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Lexicon sentiment with negation and intensifier handling, returned in
 * roughly [-1, 1]. Deliberately simple and inspectable: an opaque score would
 * be worse than a transparent approximation here.
 */
export function scoreSentiment(text) {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (!words.length) return { score: 0, positiveHits: 0, negativeHits: 0, samples: [] };
  let total = 0;
  let hits = 0;
  let pos = 0;
  let neg = 0;
  const samples = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let weight = SENTIMENT.positive[w] ?? SENTIMENT.negative[w];
    if (weight === undefined) continue;

    let multiplier = 1;
    for (let back = 1; back <= 3 && i - back >= 0; back++) {
      const prev = words[i - back];
      if (SENTIMENT.negators.includes(prev)) multiplier *= -1;
      if (SENTIMENT.intensifiers[prev]) multiplier *= SENTIMENT.intensifiers[prev];
    }
    const value = weight * multiplier;
    total += value;
    hits++;
    if (value > 0) pos++; else neg++;
    if (samples.length < 8) samples.push({ word: w, value: Number(value.toFixed(2)) });
  }

  // Normalise by hit count, not document length, so a long neutral article does
  // not dilute a clearly-argued short one to zero.
  const score = hits ? clamp(total / Math.max(6, hits), -1, 1) : 0;
  return { score, positiveHits: pos, negativeHits: neg, hits, samples };
}

/** Detects promotional patterns and returns a 0-1 hype score. */
export function scoreHype(text) {
  const flags = [];
  let weight = 0;
  for (const flag of RED_FLAGS) {
    const m = flag.re.exec(text);
    if (m) {
      flags.push(flag.label);
      weight += flag.weight;
    }
  }
  // Shouting and exclamation are weak signals on their own but add up.
  const exclamations = (text.match(/!/g) ?? []).length;
  const shouty = (text.match(/\b[A-Z]{4,}\b/g) ?? []).length;
  const per1k = (n) => (n / Math.max(1, text.length / 1000));
  if (per1k(exclamations) > 3) { weight += 0.3; flags.push('heavy exclamation use'); }
  if (per1k(shouty) > 6) { weight += 0.2; flags.push('frequent all-caps emphasis'); }

  return { hypeScore: clamp(weight / 3, 0, 1), redFlags: flags };
}

/** Detects the markers of genuine analysis and returns a 0-1 rigour score. */
export function scoreRigour(text) {
  const markers = [];
  let weight = 0;
  for (const marker of CREDIBILITY_MARKERS) {
    if (marker.re.test(text)) {
      markers.push(marker.label);
      weight += marker.weight;
    }
  }
  // Density of actual numbers separates analysis from opinion.
  const numbers = (text.match(/\b\d+(\.\d+)?%|\$\d[\d,]*(\.\d+)?[kmbt]?\b/gi) ?? []).length;
  const numberDensity = numbers / Math.max(1, text.length / 1000);
  if (numberDensity > 2) { weight += 0.5; markers.push('data-dense'); }
  else if (numberDensity > 0.7) { weight += 0.25; }

  return { rigourScore: clamp(weight / 3.5, 0, 1), markers };
}

/** Pulls out explicit numeric claims so they can be shown next to the maths. */
export function extractClaims(text) {
  const claims = [];
  const patterns = [
    { re: /\b(?:price\s+target|pt|target\s+price)\s*(?:of|:)?\s*\$?([\d,]+(?:\.\d+)?)/gi, kind: 'price target' },
    { re: /\b([\d.]+)%\s+(?:annual|annualized|annualised|yearly|a\s+year)\s+(?:return|returns|yield|growth)/gi, kind: 'return claim' },
    { re: /\b(?:yield(?:ing|s)?|dividend\s+yield)\s+(?:of\s+)?([\d.]+)%/gi, kind: 'yield' },
    { re: /\b(?:p\/e|pe\s+ratio|price[- ]to[- ]earnings)\s+(?:of\s+|is\s+|at\s+)?([\d.]+)/gi, kind: 'P/E' },
    { re: /\b(?:expense\s+ratio)\s+(?:of\s+|is\s+|at\s+)?([\d.]+)%/gi, kind: 'expense ratio' },
    { re: /\b(?:up|gained|returned|rose)\s+([\d.]+)%/gi, kind: 'reported gain' },
    { re: /\b(?:down|lost|fell|dropped)\s+([\d.]+)%/gi, kind: 'reported loss' },
  ];
  for (const p of patterns) {
    for (const m of text.matchAll(p.re)) {
      const value = Number(String(m[1]).replace(/,/g, ''));
      if (Number.isFinite(value) && claims.length < 40) {
        claims.push({ kind: p.kind, value, context: contextOf(text, m.index, 70) });
      }
    }
  }
  return claims;
}

/** Detects whether the author states a recommendation and in which direction. */
export function extractStance(text) {
  const buy = (text.match(/\b(buy|accumulate|overweight|adding|bullish\s+on|long\s+position|initiating\s+a\s+position)\b/gi) ?? []).length;
  const sell = (text.match(/\b(sell|avoid|underweight|trimming|bearish\s+on|short\s+position|exiting)\b/gi) ?? []).length;
  const hold = (text.match(/\b(hold|neutral|wait|watchlist|monitor)\b/gi) ?? []).length;
  const total = buy + sell + hold;
  if (!total) return { stance: 'none', strength: 0, counts: { buy, sell, hold } };
  const stance = buy >= sell && buy >= hold ? 'buy' : sell >= hold ? 'sell' : 'hold';
  return { stance, strength: clamp(Math.max(buy, sell, hold) / total, 0, 1), counts: { buy, sell, hold } };
}

/** Recency: fresher research deserves more weight, and stale research says so. */
export function assessRecency(publishedIso) {
  if (!publishedIso) return { ageDays: null, factor: 0.75, note: 'No publication date found.' };
  const t = Date.parse(publishedIso);
  if (!Number.isFinite(t)) return { ageDays: null, factor: 0.75, note: 'Unparseable publication date.' };
  const ageDays = Math.max(0, Math.round((Date.now() - t) / 86400000));
  // Half-life of roughly a year for the relevance of a specific recommendation.
  const factor = clamp(Math.exp(-ageDays / 365), 0.25, 1);
  const note = ageDays > 730 ? `Published ${(ageDays / 365).toFixed(1)} years ago — treat specific calls as historical.`
    : ageDays > 180 ? `Published ${Math.round(ageDays / 30)} months ago.`
      : `Published ${ageDays} days ago.`;
  return { ageDays, factor, note };
}

/**
 * Full analysis of one fetched document.
 * @param doc {{url, title, text, published, kind}}
 */
export function analyseDocument(doc) {
  const text = doc.text ?? '';
  const sentiment = scoreSentiment(text);
  const hype = scoreHype(text);
  const rigour = scoreRigour(text);
  const stance = extractStance(text);
  const recency = assessRecency(doc.published);
  const instruments = extractInstruments(text, { title: doc.title ?? '' });

  let host = '';
  try { host = new URL(doc.url).hostname; } catch { /* non-URL sources */ }
  const tier = domainTier(host);

  // Credibility blends the domain prior with what the document actually does:
  // rigour lifts it, promotional language sinks it, staleness discounts it.
  const credibility = clamp(
    0.45 * tier.tier + 0.35 * rigour.rigourScore + 0.2 * recency.factor - 0.5 * hype.hypeScore,
    0, 1,
  );

  return {
    url: doc.url,
    title: doc.title ?? doc.url,
    kind: doc.kind ?? 'article',
    host,
    sourceTier: tier,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    sentiment,
    hype,
    rigour,
    stance,
    recency,
    credibility,
    claims: extractClaims(text),
    instruments,
    note: doc.note ?? null,
  };
}

/**
 * Rolls every document's read-through up per instrument. This is where the
 * "wide and deep range of sources" becomes one evidence record per candidate,
 * weighted by how much each source deserves to be believed.
 */
export function aggregateEvidence(analyses) {
  const bySymbol = new Map();

  for (const doc of analyses) {
    for (const inst of doc.instruments) {
      // Ignore drive-by mentions from weak sources entirely.
      if (inst.confidence < 0.6 && !inst.known) continue;
      const entry = bySymbol.get(inst.symbol) ?? {
        symbol: inst.symbol,
        name: inst.name,
        assetClass: inst.assetClass,
        known: inst.known,
        sources: [],
        totalMentions: 0,
      };
      entry.sources.push({
        url: doc.url,
        title: doc.title,
        host: doc.host,
        kind: doc.kind,
        tier: doc.sourceTier.label,
        credibility: doc.credibility,
        sentiment: doc.sentiment.score,
        hype: doc.hype.hypeScore,
        redFlags: doc.hype.redFlags,
        rigour: doc.rigour.rigourScore,
        stance: doc.stance.stance,
        confidence: inst.confidence,
        prominence: inst.prominence,
        mentions: inst.mentions,
        recency: doc.recency,
        quotes: inst.evidence.slice(0, 2),
      });
      entry.totalMentions += inst.mentions;
      bySymbol.set(inst.symbol, entry);
    }
  }

  return [...bySymbol.values()].map((e) => {
    // Weight each source by credibility x how prominently the name featured.
    const weights = e.sources.map((s) => Math.max(0.05, s.credibility * s.prominence));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    const wavg = (sel) => e.sources.reduce((acc, s, i) => acc + weights[i] * sel(s), 0) / wsum;

    const redFlags = [...new Set(e.sources.flatMap((s) => s.redFlags))];
    const stances = e.sources.map((s) => s.stance);
    return {
      ...e,
      sourceCount: e.sources.length,
      credibility: wavg((s) => s.credibility),
      sentiment: wavg((s) => s.sentiment),
      hypeScore: wavg((s) => s.hype),
      rigour: wavg((s) => s.rigour),
      extractionConfidence: Math.max(...e.sources.map((s) => s.confidence)),
      redFlags,
      bestSourceTier: e.sources.reduce((a, b) => (b.credibility > a.credibility ? b : a)).tier,
      stanceSummary: {
        buy: stances.filter((s) => s === 'buy').length,
        sell: stances.filter((s) => s === 'sell').length,
        hold: stances.filter((s) => s === 'hold').length,
      },
      // Corroboration across independent hosts is worth more than repetition.
      independentHosts: new Set(e.sources.map((s) => s.host)).size,
    };
  }).sort((a, b) => b.credibility * b.sourceCount - a.credibility * a.sourceCount);
}
