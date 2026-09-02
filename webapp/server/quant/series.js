// Price-series handling: alignment across instruments, return construction and
// calendar arithmetic. Everything downstream assumes series produced here.

import { isFiniteNum } from './mathx.js';

export const TRADING_DAYS = 252;

/**
 * Normalises a raw provider payload into {dates: string[], closes: number[]}
 * sorted ascending, with non-finite and duplicate observations removed.
 */
export function normaliseSeries(dates, closes) {
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < Math.min(dates.length, closes.length); i++) {
    const d = String(dates[i]).slice(0, 10);
    const c = Number(closes[i]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isFiniteNum(c) || c <= 0) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    rows.push([d, c]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { dates: rows.map((r) => r[0]), closes: rows.map((r) => r[1]) };
}

/** Simple (arithmetic) period returns. */
export function simpleReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) out.push(closes[i] / prev - 1);
  }
  return out;
}

/**
 * Inner-joins several series on their common dates. Returns the shared date
 * vector plus a per-symbol aligned close vector. Symbols whose overlap with the
 * intersection is too short are reported separately rather than silently kept,
 * because a short overlap quietly poisons every covariance estimate.
 */
export function alignSeries(seriesBySymbol, minOverlap = 60) {
  const symbols = Object.keys(seriesBySymbol);
  if (!symbols.length) return { dates: [], closes: {}, symbols: [], dropped: [] };

  let common = null;
  for (const s of symbols) {
    const set = new Set(seriesBySymbol[s].dates);
    common = common === null ? set : new Set([...common].filter((d) => set.has(d)));
  }
  let dates = [...common].sort();

  // If the intersection collapsed, retry using only symbols with enough history
  // so that one short series cannot destroy the whole panel.
  const dropped = [];
  if (dates.length < minOverlap) {
    const lengths = symbols.map((s) => ({ s, n: seriesBySymbol[s].dates.length }));
    lengths.sort((a, b) => b.n - a.n);
    const keep = [];
    let running = null;
    for (const { s } of lengths) {
      const set = new Set(seriesBySymbol[s].dates);
      const next = running === null ? set : new Set([...running].filter((d) => set.has(d)));
      if (next.size >= minOverlap || keep.length === 0) {
        running = next;
        keep.push(s);
      } else {
        dropped.push(s);
      }
    }
    dates = [...(running ?? new Set())].sort();
    const kept = new Set(keep);
    for (const s of symbols) if (!kept.has(s) && !dropped.includes(s)) dropped.push(s);
  }

  const index = {};
  for (const s of symbols) {
    if (dropped.includes(s)) continue;
    const map = new Map();
    const { dates: ds, closes: cs } = seriesBySymbol[s];
    for (let i = 0; i < ds.length; i++) map.set(ds[i], cs[i]);
    index[s] = dates.map((d) => map.get(d));
  }
  return { dates, closes: index, symbols: Object.keys(index), dropped };
}

/** Downsamples a daily series to the last observation of each week or month. */
export function resample(dates, closes, freq) {
  if (freq === 'daily') return { dates: [...dates], closes: [...closes] };
  const keyOf = (d) => {
    if (freq === 'monthly') return d.slice(0, 7);
    const dt = new Date(`${d}T00:00:00Z`);
    const day = dt.getUTCDay();
    // Bucket by the Thursday of the ISO week so weeks are stable across years.
    dt.setUTCDate(dt.getUTCDate() + (4 - (day === 0 ? 7 : day)));
    return dt.toISOString().slice(0, 10);
  };
  const outDates = [];
  const outCloses = [];
  let lastKey = null;
  for (let i = 0; i < dates.length; i++) {
    const key = keyOf(dates[i]);
    if (key !== lastKey && lastKey !== null) {
      outDates.push(dates[i - 1]);
      outCloses.push(closes[i - 1]);
    }
    lastKey = key;
  }
  if (dates.length) {
    outDates.push(dates[dates.length - 1]);
    outCloses.push(closes[closes.length - 1]);
  }
  return { dates: outDates, closes: outCloses };
}

/** Number of calendar years spanned by a date vector. */
export function yearsSpanned(dates) {
  if (dates.length < 2) return 0;
  const a = Date.parse(`${dates[0]}T00:00:00Z`);
  const b = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`);
  return (b - a) / (365.25 * 24 * 3600 * 1000);
}

/** Trailing window of the last `n` observations. */
export function tail(xs, n) {
  return n >= xs.length ? [...xs] : xs.slice(xs.length - n);
}

/** Cumulative wealth index starting at 1.0 from a return vector. */
export function equityCurve(returns, start = 1) {
  const out = [start];
  for (const r of returns) out.push(out[out.length - 1] * (1 + r));
  return out;
}
