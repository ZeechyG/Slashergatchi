// HTTP layer. Deliberately dependency-free: node:http plus a static handler is
// all this needs, and it keeps the install story to "clone and run".

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, DEFAULTS } from './pipeline.js';
import { parseUserCsv } from './data/marketdata.js';
import { RISK_PROFILES } from './quant/committee.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_URLS = 40;
const MAX_BODY_BYTES = 2_000_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'POST' && url.pathname === '/api/analyze') return await handleAnalyze(req, res);
    if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, 200, config());
    if (req.method === 'GET') return await serveStatic(url.pathname, res);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error', detail: err.message });
    else res.end();
  }
});

function config() {
  return {
    defaults: {
      benchmark: DEFAULTS.benchmark,
      riskProfile: DEFAULTS.riskProfile,
      maxPositions: DEFAULTS.maxPositions,
      horizonYears: DEFAULTS.horizonYears,
      capital: DEFAULTS.capital,
      rf: DEFAULTS.rf,
    },
    profiles: Object.entries(RISK_PROFILES).map(([key, p]) => ({
      key,
      label: p.label,
      maxWeight: p.maxWeight,
      volTarget: p.maxPortfolioVol,
    })),
    maxUrls: MAX_URLS,
  };
}

/**
 * Streams newline-delimited JSON: progress events while the analysis runs,
 * then a final `result` event. A single slow provider should not leave the
 * page staring at a spinner with no idea what is happening.
 */
async function handleAnalyze(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const urls = dedupe((body.urls ?? [])
    .map((u) => String(u).trim())
    .filter(Boolean))
    .slice(0, MAX_URLS);

  const pastedSources = (body.pastedSources ?? [])
    .filter((p) => p && typeof p.text === 'string')
    .slice(0, 10);

  if (!urls.length && !pastedSources.length) {
    return sendJson(res, 400, { error: 'Supply at least one URL or pasted source.' });
  }

  const options = {
    benchmark: sanitiseSymbol(body.benchmark) || DEFAULTS.benchmark,
    riskProfile: RISK_PROFILES[body.riskProfile] ? body.riskProfile : DEFAULTS.riskProfile,
    maxPositions: clampInt(body.maxPositions, 2, 15, DEFAULTS.maxPositions),
    horizonYears: clampInt(body.horizonYears, 1, 30, DEFAULTS.horizonYears),
    capital: Number.isFinite(Number(body.capital)) ? Math.max(0, Number(body.capital)) : DEFAULTS.capital,
    rf: Number.isFinite(Number(body.rf)) ? Math.min(0.2, Math.max(0, Number(body.rf))) : DEFAULTS.rf,
    allowSynthetic: body.allowSynthetic === true,
    pastedSources,
    userSeries: body.priceCsv ? parseUserCsv(String(body.priceCsv)) : undefined,
  };

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });

  const write = (obj) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
  };

  // A heartbeat keeps intermediaries from closing an idle connection during a
  // long provider fetch.
  const heartbeat = setInterval(() => write({ type: 'ping', t: Date.now() }), 10000);

  try {
    const result = await analyse(urls, options, (event) => write({ type: 'progress', ...event }));
    write({ type: 'result', result });
  } catch (err) {
    console.error('[analyze]', err);
    write({ type: 'error', error: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, rel);
  // Contain path traversal: the resolved path must stay inside PUBLIC_DIR.
  if (!path.resolve(target).startsWith(path.resolve(PUBLIC_DIR))) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Body was not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const dedupe = (xs) => [...new Set(xs)];
const clampInt = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};
const sanitiseSymbol = (s) => (typeof s === 'string' ? s.trim().toUpperCase().replace(/[^A-Z.\-]/g, '').slice(0, 6) : '');

server.listen(PORT, HOST, () => {
  console.log(`Capital Allocator running at http://${HOST}:${PORT}`);
});

export { server };
