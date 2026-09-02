// Price history. Every series carries a `source` label all the way to the UI,
// because an allocation built on a fallback series and one built on real prices
// are not the same claim and must never look the same on screen.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchUrl } from '../ingest/fetcher.js';
import { parseDelimited } from '../ingest/html.js';
import { normaliseSeries } from '../quant/series.js';

const CACHE_DIR = path.join(process.cwd(), '.cache', 'prices');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // intraday refresh is pointless here

export const SOURCE_LABELS = {
  stooq: 'Stooq end-of-day history',
  yahoo: 'Yahoo Finance chart API',
  cache: 'local cache',
  fixture: 'bundled offline fixture',
  synthetic: 'SIMULATED — not real market data',
  user: 'user-supplied CSV',
};

/** Series shorter than this cannot support any of the statistics downstream. */
export const MIN_OBSERVATIONS = 120;

async function readCache(symbol) {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${symbol}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(symbol, payload) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${symbol}.json`), JSON.stringify(payload), 'utf8');
  } catch { /* cache is an optimisation, never a requirement */ }
}

/** Stooq: free end-of-day CSV, no key. US tickers take a `.us` suffix. */
async function fromStooq(symbol) {
  const s = symbol.toLowerCase().replace('-', '.');
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}.us&i=d`;
  const res = await fetchUrl(url, { timeoutMs: 12000 });
  if (!res.ok) throw new Error(res.reason);
  const rows = parseDelimited(res.body);
  if (rows.length < 2 || !/date/i.test(rows[0][0] ?? '')) {
    throw new Error('Stooq returned no usable rows (symbol unknown or rate limited)');
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const di = header.indexOf('date');
  const ci = header.indexOf('close');
  if (di === -1 || ci === -1) throw new Error('Unexpected Stooq CSV layout');
  const dates = [];
  const closes = [];
  for (const r of rows.slice(1)) {
    dates.push(r[di]);
    closes.push(Number(r[ci]));
  }
  return normaliseSeries(dates, closes);
}

/** Yahoo chart JSON: broader coverage, but frequently rate limited. */
async function fromYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`;
  const res = await fetchUrl(url, { timeoutMs: 12000 });
  if (!res.ok) throw new Error(res.reason);
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new Error('Yahoo returned a non-JSON body (likely rate limited)');
  }
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || 'No chart data returned');
  const stamps = result.timestamp ?? [];
  // Adjusted closes where available: dividends and splits are not returns we
  // get to ignore.
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const raw = result.indicators?.quote?.[0]?.close;
  const closes = adj ?? raw ?? [];
  const dates = stamps.map((t) => new Date(t * 1000).toISOString().slice(0, 10));
  return normaliseSeries(dates, closes);
}

/** Offline fixtures shipped with the repo, used for tests and demos. */
async function fromFixture(symbol) {
  const dir = process.env.PRICE_FIXTURE_DIR || path.join(process.cwd(), 'fixtures', 'prices');
  const file = path.join(dir, `${symbol.toUpperCase()}.csv`);
  const raw = await fs.readFile(file, 'utf8');
  const rows = parseDelimited(raw);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const di = header.indexOf('date');
  const ci = header.indexOf('close');
  return normaliseSeries(rows.slice(1).map((r) => r[di]), rows.slice(1).map((r) => Number(r[ci])));
}

/**
 * Deterministic simulated history. This exists so the application is
 * demonstrable with no network access; it is labelled as simulated everywhere
 * it surfaces and is never used unless explicitly enabled.
 */
export function syntheticSeries(symbol, { years = 6, seed = null } = {}) {
  let s = seed ?? [...symbol].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };

  // Give each symbol a stable but distinct drift/vol so cross-sectional
  // comparisons in a demo are at least internally coherent.
  const drift = 0.02 + (s % 97) / 97 * 0.12;
  const baseVol = 0.1 + ((s >> 7) % 89) / 89 * 0.32;

  // Walk back over calendar days and skip weekends, so `years` means years of
  // history (~252 trading days each) rather than 252 calendar days.
  const calendarDays = Math.round(years * 365.25);
  const dates = [];
  const closes = [];
  let price = 50 + (s % 200);
  let vol = baseVol;
  const today = new Date();
  for (let i = calendarDays; i > 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    // GARCH-ish volatility clustering so the risk metrics have something real
    // to measure rather than clean Gaussian noise.
    vol = Math.sqrt(0.94 * vol * vol + 0.06 * baseVol * baseVol) * (0.99 + rnd() * 0.02);
    const r = drift / 252 + (vol / Math.sqrt(252)) * gauss();
    price *= 1 + r;
    dates.push(d.toISOString().slice(0, 10));
    closes.push(Number(price.toFixed(4)));
  }
  return normaliseSeries(dates, closes);
}

/**
 * Fetches one symbol through the provider chain, returning the first series
 * that is long enough to analyse.
 *
 * @param opts.allowSynthetic enable the simulated fallback (demo mode)
 * @param opts.userSeries     pre-supplied {dates, closes} keyed by symbol
 */
export async function getSeries(symbol, opts = {}) {
  const sym = symbol.toUpperCase();
  const attempts = [];

  if (opts.userSeries?.[sym]) {
    const s = normaliseSeries(opts.userSeries[sym].dates, opts.userSeries[sym].closes);
    if (s.closes.length >= MIN_OBSERVATIONS) return { symbol: sym, ...s, source: 'user', attempts };
    attempts.push({ provider: 'user', error: `only ${s.closes.length} usable rows` });
  }

  const cached = await readCache(sym);
  if (cached?.closes?.length >= MIN_OBSERVATIONS) {
    return { symbol: sym, dates: cached.dates, closes: cached.closes, source: cached.source, cached: true, attempts };
  }

  // Live providers first: a stale CSV sitting in fixtures/ must never silently
  // shadow real market data. The fixture directory is an offline fallback.
  const providers = [['stooq', fromStooq], ['yahoo', fromYahoo], ['fixture', fromFixture]];

  for (const [name, fn] of providers) {
    try {
      const s = await fn(sym);
      if (s.closes.length >= MIN_OBSERVATIONS) {
        const payload = { symbol: sym, ...s, source: name, fetchedAt: Date.now() };
        await writeCache(sym, payload);
        return { ...payload, attempts };
      }
      attempts.push({ provider: name, error: `only ${s.closes.length} observations returned` });
    } catch (err) {
      attempts.push({ provider: name, error: err.message });
    }
  }

  if (opts.allowSynthetic) {
    const s = syntheticSeries(sym);
    return { symbol: sym, ...s, source: 'synthetic', simulated: true, attempts };
  }

  return { symbol: sym, dates: [], closes: [], source: null, error: 'No provider returned usable price history.', attempts };
}

/** Fetches many symbols with bounded concurrency. */
export async function getManySeries(symbols, opts = {}, onProgress = null) {
  const out = {};
  const limit = opts.concurrency ?? 4;
  const queue = [...new Set(symbols.map((s) => s.toUpperCase()))];
  let done = 0;

  async function worker() {
    for (;;) {
      const sym = queue.shift();
      if (!sym) return;
      out[sym] = await getSeries(sym, opts);
      done++;
      onProgress?.({ symbol: sym, done, total: done + queue.length, source: out[sym].source });
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return out;
}

/** Parses a user-pasted CSV block into series keyed by symbol. */
export function parseUserCsv(text) {
  const rows = parseDelimited(text.trim());
  if (rows.length < 2) return {};
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const di = header.findIndex((h) => h === 'date');
  if (di === -1) return {};
  const symbolCol = header.findIndex((h) => h === 'symbol' || h === 'ticker');

  const out = {};
  if (symbolCol !== -1) {
    // Long format: date,symbol,close
    const ci = header.findIndex((h) => h === 'close' || h === 'price' || h === 'adj close');
    for (const r of rows.slice(1)) {
      const sym = (r[symbolCol] ?? '').trim().toUpperCase();
      if (!sym) continue;
      out[sym] ??= { dates: [], closes: [] };
      out[sym].dates.push(r[di]);
      out[sym].closes.push(Number(r[ci]));
    }
  } else {
    // Wide format: date,AAPL,MSFT,...
    for (let c = 0; c < header.length; c++) {
      if (c === di) continue;
      const sym = header[c].toUpperCase();
      out[sym] = { dates: [], closes: [] };
      for (const r of rows.slice(1)) {
        out[sym].dates.push(r[di]);
        out[sym].closes.push(Number(r[c]));
      }
    }
  }
  for (const k of Object.keys(out)) {
    const n = normaliseSeries(out[k].dates, out[k].closes);
    if (n.closes.length < 2) delete out[k];
    else out[k] = n;
  }
  return out;
}
