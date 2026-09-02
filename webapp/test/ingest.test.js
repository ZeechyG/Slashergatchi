import test from 'node:test';
import assert from 'node:assert/strict';

import { isBlockedAddress, vetUrl } from '../server/ingest/fetcher.js';
import { htmlToText, extractMetadata, decodeEntities, parseDelimited } from '../server/ingest/html.js';
import { videoId, isYouTube } from '../server/ingest/youtube.js';
import {
  extractInstruments, scoreSentiment, scoreHype, scoreRigour,
  extractClaims, extractStance, analyseDocument, aggregateEvidence, assessRecency,
} from '../server/ingest/extract.js';
import { parseUserCsv, syntheticSeries } from '../server/data/marketdata.js';
import { classify, isSingleName } from '../server/data/universe.js';

test('private and reserved address space is refused', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) {
    assert.ok(isBlockedAddress(ip), `${ip} must be blocked`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111']) {
    assert.ok(!isBlockedAddress(ip), `${ip} must be allowed`);
  }
});

test('URL vetting rejects non-HTTP schemes and internal hosts', async () => {
  assert.equal((await vetUrl('file:///etc/passwd')).ok, false);
  assert.equal((await vetUrl('gopher://example.com')).ok, false);
  assert.equal((await vetUrl('http://localhost:9000')).ok, false);
  assert.equal((await vetUrl('http://foo.internal/x')).ok, false);
  assert.equal((await vetUrl('http://127.0.0.1/')).ok, false);
  assert.equal((await vetUrl('not a url')).ok, false);
});

test('HTML is reduced to readable text', () => {
  const html = `<html><head><title>Report &amp; Notes</title>
    <meta name="description" content="A description">
    <meta property="article:published_time" content="2025-03-04T00:00:00Z"></head>
    <body><nav>Home About Contact</nav>
    <script>window.tracking = 1;</script>
    <article><p>Apple (NASDAQ: AAPL) trades at 28x earnings.</p><ul><li>First point</li></ul></article>
    <footer>Copyright</footer></body></html>`;
  const meta = extractMetadata(html);
  assert.equal(meta.title, 'Report & Notes');
  assert.equal(meta.description, 'A description');
  assert.equal(meta.published, '2025-03-04T00:00:00Z');

  const text = htmlToText(html);
  assert.ok(text.includes('28x earnings'));
  assert.ok(text.includes('First point'));
  assert.ok(!text.includes('window.tracking'), 'scripts must be stripped');
  assert.ok(!text.includes('About Contact'), 'navigation must be stripped');
});

test('entity decoding covers named and numeric references', () => {
  assert.equal(decodeEntities('S&amp;P 500 &#8212; up 5&#37;'), 'S&P 500 — up 5%');
  assert.equal(decodeEntities('&lt;tag&gt; &quot;q&quot; &#x2019;'), '<tag> "q" ’');
});

test('delimited parsing handles quotes and embedded separators', () => {
  const rows = parseDelimited('a,b\n"x,1",2\n"he said ""hi""",3');
  assert.deepEqual(rows, [['a', 'b'], ['x,1', '2'], ['he said "hi"', '3']]);
});

test('YouTube URL forms are recognised', () => {
  assert.equal(videoId('https://www.youtube.com/watch?v=abc12345678'), 'abc12345678');
  assert.equal(videoId('https://youtu.be/xyz98765432?t=90'), 'xyz98765432');
  assert.equal(videoId('https://www.youtube.com/shorts/short123'), 'short123');
  assert.equal(videoId('https://example.com/watch?v=nope'), null);
  assert.ok(isYouTube('https://m.youtube.com/watch?v=a'));
  assert.ok(!isYouTube('https://vimeo.com/1'));
});

test('instrument extraction finds tickers and rejects finance jargon', () => {
  const text = `Our CEO discussed the ETF landscape. $NVDA and NASDAQ: AAPL both beat EPS
    estimates, while Vanguard Total Stock Market ETF (VTI) lagged. The IRS and SEC had no comment.
    GDP growth and the CPI print were fine.`;
  const found = extractInstruments(text, { title: 'NVDA and AAPL' });
  const symbols = found.map((f) => f.symbol);
  assert.ok(symbols.includes('NVDA'));
  assert.ok(symbols.includes('AAPL'));
  assert.ok(symbols.includes('VTI'));
  for (const junk of ['CEO', 'ETF', 'EPS', 'IRS', 'SEC', 'GDP', 'CPI']) {
    assert.ok(!symbols.includes(junk), `${junk} must not be treated as a ticker`);
  }
  // A cashtag is more certain than a bare uppercase word.
  assert.ok(found.find((f) => f.symbol === 'NVDA').confidence > 0.9);
});

test('company names in prose resolve to tickers', () => {
  const found = extractInstruments('We remain long Microsoft and hold gold as a hedge.');
  const symbols = found.map((f) => f.symbol);
  assert.ok(symbols.includes('MSFT'));
  assert.ok(symbols.includes('GLD'));
});

test('sentiment handles negation and direction', () => {
  assert.ok(scoreSentiment('The stock is undervalued with a strong moat').score > 0);
  assert.ok(scoreSentiment('The stock is overvalued and deteriorating').score < 0);
  const plain = scoreSentiment('This is attractive');
  const negated = scoreSentiment('This is not attractive');
  assert.ok(negated.score < plain.score, 'negation must flip the sign');
});

test('promotional language is separated from genuine analysis', () => {
  const pitch = `GUARANTEED RETURNS!!! This secret stock will 10x your money.
    Join my discord, use my referral link. You can't lose. ACT NOW before it's too late! I am ALL IN.`;
  const research = `We estimate fair value using a discounted cash flow. Risks include margin
    compression. Bear case: if rates stay high, the multiple compresses. Disclosure: the author is
    long the shares. Expense ratio of 0.03%. Standard deviation was 14.2% with a max drawdown of 31%.`;

  const h1 = scoreHype(pitch);
  const h2 = scoreHype(research);
  assert.ok(h1.hypeScore > 0.6, `pitch should score high on hype, got ${h1.hypeScore}`);
  assert.ok(h2.hypeScore < 0.15, `research should score low on hype, got ${h2.hypeScore}`);
  assert.ok(h1.redFlags.length >= 4);

  assert.ok(scoreRigour(research).rigourScore > scoreRigour(pitch).rigourScore);
});

test('numeric claims and author stance are extracted', () => {
  const claims = extractClaims('Our price target of $250 implies a 12% annual return. Yield of 3.4%. P/E of 18.');
  const kinds = claims.map((c) => c.kind);
  assert.ok(kinds.includes('price target'));
  assert.ok(kinds.includes('return claim'));
  assert.ok(kinds.includes('yield'));
  assert.equal(claims.find((c) => c.kind === 'price target').value, 250);

  assert.equal(extractStance('We are buying and accumulating, adding to the position').stance, 'buy');
  assert.equal(extractStance('Avoid this. We are trimming and exiting, bearish on the name.').stance, 'sell');
  assert.equal(extractStance('Nothing directional here').stance, 'none');
});

test('recency discounts older material', () => {
  const fresh = assessRecency(new Date(Date.now() - 5 * 86400000).toISOString());
  const stale = assessRecency(new Date(Date.now() - 900 * 86400000).toISOString());
  assert.ok(fresh.factor > stale.factor);
  assert.ok(stale.note.includes('years ago'));
  assert.equal(assessRecency(null).ageDays, null);
});

test('a promotional source scores far below a rigorous one', () => {
  const promo = analyseDocument({
    url: 'https://www.youtube.com/watch?v=x', kind: 'youtube',
    title: 'This SECRET stock will 10x your money!!!',
    text: `GUARANTEED RETURNS! $NVDA is going to the moon!! Join my discord and use my referral
      link. You can't lose. This is the next Tesla. ACT NOW before it's too late!!! I am ALL IN.`,
  });
  const serious = analyseDocument({
    url: 'https://www.ft.com/content/abc', kind: 'article',
    title: 'The case for global diversification', published: '2026-06-01',
    text: `We examine VTI, VXUS and BND. The Sharpe ratio of a 60/40 portfolio was 0.62 with
      volatility of 11.2% and a maximum drawdown of 24%. Risks include duration exposure. Bear case:
      if inflation reaccelerates, the correlation between stocks and bonds rises. Disclosure: the
      author is long VTI. Source: fund data. Expense ratio of 0.03%.`,
  });
  assert.ok(serious.credibility > 0.6, `serious credibility ${serious.credibility}`);
  assert.ok(promo.credibility < 0.2, `promo credibility ${promo.credibility}`);
  assert.ok(promo.hype.hypeScore > serious.hype.hypeScore + 0.5);

  const evidence = aggregateEvidence([promo, serious]);
  const nvda = evidence.find((e) => e.symbol === 'NVDA');
  const vti = evidence.find((e) => e.symbol === 'VTI');
  assert.ok(nvda && vti);
  assert.ok(vti.credibility > nvda.credibility, 'corroborated research must outrank a pitch');
  assert.ok(nvda.redFlags.length > 0);
});

test('user CSV parsing accepts wide and long layouts', () => {
  const wide = parseUserCsv('date,AAPL,MSFT\n2024-01-02,100,200\n2024-01-03,101,201');
  assert.deepEqual(wide.AAPL.closes, [100, 101]);
  assert.deepEqual(wide.MSFT.closes, [200, 201]);

  const long = parseUserCsv('date,symbol,close\n2024-01-02,QQQ,300\n2024-01-03,QQQ,303');
  assert.deepEqual(long.QQQ.closes, [300, 303]);
  assert.deepEqual(Object.keys(parseUserCsv('nonsense')), []);
});

test('simulated series are deterministic and well-formed', () => {
  const a = syntheticSeries('TEST', { years: 3 });
  const b = syntheticSeries('TEST', { years: 3 });
  assert.deepEqual(a.closes, b.closes, 'same symbol must always produce the same series');
  assert.notDeepEqual(syntheticSeries('OTHER', { years: 3 }).closes, a.closes);
  assert.ok(a.closes.every((c) => c > 0));
  // Three years of history is ~252 trading days a year.
  assert.ok(a.closes.length > 740 && a.closes.length < 800, `got ${a.closes.length} observations`);
});

test('instruments are classified by asset class', () => {
  assert.equal(classify('SPY'), 'equity-index');
  assert.equal(classify('TLT'), 'bond-long');
  assert.equal(classify('GLD'), 'commodity');
  assert.equal(classify('ZZZZ'), 'unknown');
  assert.ok(isSingleName('AAPL'));
  assert.ok(!isSingleName('VTI'));
});
