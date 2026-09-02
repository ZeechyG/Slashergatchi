import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse } from '../server/pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, 'fixtures', 'docs');

// Price fixtures are deterministic simulated series; they exercise the maths
// without depending on a live provider inside CI.
process.env.PRICE_FIXTURE_DIR = path.join(here, 'fixtures', 'prices');

/** Serves the fixture documents over loopback so the real fetch path is used. */
function startDocServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = req.url.replace(/^\/+/, '').split('?')[0];
      const file = path.join(DOCS, name);
      if (!file.startsWith(DOCS) || !fs.existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/**
 * The fetcher refuses loopback addresses by design, so the end-to-end test
 * feeds the same documents in through the pasted-source path — which exercises
 * ingestion, pricing, the committee and portfolio construction identically.
 */
function pastedFrom(file, url, title) {
  const html = fs.readFileSync(path.join(DOCS, file), 'utf8');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return { url, title, text };
}

test('loopback URLs are refused even when a server is listening', async () => {
  const server = await startDocServer();
  const { port } = server.address();
  try {
    const result = await analyse([`http://127.0.0.1:${port}/research.html`], {});
    assert.equal(result.ok, false);
    assert.match(result.failures[0].reason, /private|reserved|internal/i);
  } finally {
    server.close();
  }
});

test('end-to-end: sources become a scored, constrained allocation', async () => {
  const result = await analyse([], {
    riskProfile: 'balanced',
    benchmark: 'SPY',
    capital: 25000,
    maxPositions: 6,
    pastedSources: [
      pastedFrom('research.html', 'https://www.ft.com/content/core-portfolio', 'Building a durable core portfolio'),
      pastedFrom('pitch.html', 'https://www.youtube.com/watch?v=hype', 'This SECRET AI stock will 10x'),
      pastedFrom('fundpage.html', 'https://www.schwab.com/schd', 'SCHD fund profile'),
    ],
  });

  assert.equal(result.ok, true, result.error);

  // Ingestion found the instruments the documents actually discuss.
  const symbols = result.evidence.map((e) => e.symbol);
  for (const expected of ['VTI', 'BND', 'GLD', 'SCHD']) {
    assert.ok(symbols.includes(expected), `expected ${expected} in ${symbols.join(',')}`);
  }

  // The promotional source is scored as such.
  const pitchDoc = result.documents.find((d) => d.url.includes('youtube'));
  const researchDoc = result.documents.find((d) => d.url.includes('ft.com'));
  assert.ok(pitchDoc.hype.hypeScore > 0.5, `pitch hype ${pitchDoc.hype.hypeScore}`);
  assert.ok(researchDoc.credibility > pitchDoc.credibility + 0.3);

  // Names carried only by the pitch are rejected by the diligence seat.
  const nvda = result.candidates.find((c) => c.symbol === 'NVDA');
  if (nvda) {
    assert.ok(nvda.blocked, 'a name sourced only from a promotional video must be blocked');
    assert.ok(nvda.vetoes.some((v) => v.id === 'promotional-source'));
  }

  // Portfolio is valid and honours its constraints.
  const p = result.portfolio;
  assert.ok(p, 'a portfolio should be produced');
  const total = p.holdings.reduce((a, h) => a + h.weight, 0) + p.cash.weight;
  assert.ok(Math.abs(total - 1) < 1e-6, `weights must sum to 1, got ${total}`);
  assert.ok(p.holdings.every((h) => h.weight >= 0));
  assert.ok(p.holdings.length <= 6, 'max positions respected');
  const maxRisky = Math.max(...p.holdings.map((h) => h.weightOfRisky));
  assert.ok(maxRisky <= result.profile.maxWeight + 1e-6, `position cap breached: ${maxRisky}`);
  assert.ok(p.expected.volatility <= result.profile.maxPortfolioVol + 1e-6,
    `vol budget breached: ${p.expected.volatility}`);

  // Dollar amounts reconcile with the capital supplied.
  const dollars = p.holdings.reduce((a, h) => a + h.dollars, 0) + p.cash.dollars;
  assert.ok(Math.abs(dollars - 25000) < 1, `dollars should reconcile, got ${dollars}`);

  // Every candidate carries the full evidence trail and a written thesis.
  for (const c of result.candidates) {
    assert.ok(c.thesis.length > 80, `${c.symbol} needs a thesis`);
    assert.ok(Array.isArray(c.votes) && c.votes.length === 5, `${c.symbol} needs five committee votes`);
    assert.ok(Number.isFinite(c.consensus) && Number.isFinite(c.conviction));
    assert.ok(c.evidence.sources.length > 0, `${c.symbol} needs a source trail`);
  }

  // Validation ran and reports out-of-sample numbers alongside in-sample ones.
  assert.ok(result.validation.backtest.returns.length > 200);
  assert.ok(result.validation.comparison.some((r) => r.name === 'equalWeight'));
  assert.ok(result.validation.monteCarlo.terminalMultiple.p5 <= result.validation.monteCarlo.terminalMultiple.p95);

  // Fixture-sourced prices must be labelled, never passed off as live data.
  assert.ok(result.dataProvenance.bySource.every((s) => s.source && s.label));
});

test('a risk mandate materially changes the answer', async () => {
  const sources = [pastedFrom('research.html', 'https://www.ft.com/content/x', 'Core portfolio')];
  const conservative = await analyse([], { riskProfile: 'conservative', pastedSources: sources });
  const aggressive = await analyse([], { riskProfile: 'aggressive', pastedSources: sources });

  assert.ok(conservative.ok && aggressive.ok);
  assert.ok(conservative.portfolio.expected.volatility <= aggressive.portfolio.expected.volatility + 1e-9,
    'a conservative mandate must not take more risk than an aggressive one');
  assert.ok(conservative.profile.maxWeight < aggressive.profile.maxWeight);
});

test('an empty or unreadable input set fails loudly rather than inventing an answer', async () => {
  const result = await analyse(['https://not-a-real-host-xyzzy.invalid/page'], {});
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
  assert.equal(result.portfolio, undefined);
});
