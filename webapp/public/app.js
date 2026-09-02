// Client. Streams NDJSON progress from /api/analyze and renders the result.
// No framework: the page is one render pass over a JSON document.

const $ = (sel) => document.querySelector(sel);
const form = $('#analyze-form');
const logEl = $('#log');
const logPanel = $('#log-panel');
const resultsEl = $('#results');
const statusEl = $('#status');
const runBtn = $('#run');
const cancelBtn = $('#cancel');
let controller = null;

// ---- formatting ------------------------------------------------------------

const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—');
const num = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const money = (x) => (Number.isFinite(x)
  ? x.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : '—');
const sign = (x, d = 1) => (Number.isFinite(x) ? `<span class="${x >= 0 ? 'pos' : 'neg'}">${pct(x, d)}</span>` : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- boot ------------------------------------------------------------------

(async function init() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    const sel = $('#riskProfile');
    sel.innerHTML = cfg.profiles.map((p) =>
      `<option value="${p.key}"${p.key === cfg.defaults.riskProfile ? ' selected' : ''}>${esc(p.label)} — ${(p.volTarget * 100).toFixed(0)}% vol budget, max ${(p.maxWeight * 100).toFixed(0)}% per position</option>`).join('');
  } catch {
    $('#riskProfile').innerHTML = '<option value="balanced">Balanced</option>';
  }
}());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const urls = $('#urls').value.split(/[\n\s,]+/).map((s) => s.trim()).filter(Boolean);
  const pastedText = $('#pasted').value.trim();
  if (!urls.length && !pastedText) {
    statusEl.textContent = 'Add at least one URL, or paste some source text.';
    return;
  }

  // Each pasted document is scored separately: blending a research note and a
  // promotional video into one blob would give them a single shared
  // credibility, and the worst source would drag the rest down with it.
  const pastedSources = pastedText
    ? pastedText.split(/^\s*-{3,}\s*$/m)
      .map((t) => t.trim())
      .filter((t) => t.length > 120)
      .map((t, i, arr) => ({
        text: t,
        title: arr.length > 1 ? `Pasted source ${i + 1}` : 'Pasted source material',
      }))
    : [];

  const payload = {
    urls,
    pastedSources,
    benchmark: $('#benchmark').value.trim() || 'SPY',
    riskProfile: $('#riskProfile').value,
    capital: Number($('#capital').value),
    maxPositions: Number($('#maxPositions').value),
    horizonYears: Number($('#horizonYears').value),
    rf: Number($('#rf').value) / 100,
    allowSynthetic: $('#allowSynthetic').checked,
    priceCsv: $('#priceCsv').value.trim() || undefined,
  };

  startRun();
  controller = new AbortController();
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await consumeStream(res.body, (msg) => {
      if (msg.type === 'progress') appendLog(msg);
      else if (msg.type === 'result') render(msg.result);
      else if (msg.type === 'error') fail(msg.error);
    });
  } catch (err) {
    if (err.name !== 'AbortError') fail(err.message);
  } finally {
    endRun();
  }
});

cancelBtn.addEventListener('click', () => controller?.abort());

function startRun() {
  logEl.innerHTML = '';
  logPanel.hidden = false;
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';
  runBtn.disabled = true;
  cancelBtn.hidden = false;
  statusEl.textContent = 'Running…';
}
function endRun() {
  runBtn.disabled = false;
  cancelBtn.hidden = true;
  controller = null;
}
function fail(message) {
  statusEl.textContent = '';
  resultsEl.hidden = false;
  resultsEl.innerHTML = `<div class="banner warn"><strong>Analysis failed.</strong> ${esc(message)}</div>`;
}

/** Parses a newline-delimited JSON stream incrementally. */
async function consumeStream(body, onMessage) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { onMessage(JSON.parse(line)); } catch { /* partial frame */ }
    }
  }
  if (buffer.trim()) {
    try { onMessage(JSON.parse(buffer)); } catch { /* ignore trailing noise */ }
  }
}

function appendLog(msg) {
  const li = document.createElement('li');
  if (msg.status === 'done') li.className = 'done';
  li.innerHTML = `<span class="stage">${esc(msg.stage)}</span><span>${esc(msg.message)}</span>`;
  logEl.append(li);
  for (const d of (msg.detail ?? []).slice(0, 14)) {
    const sub = document.createElement('li');
    sub.className = 'detail';
    sub.textContent = d;
    logEl.append(sub);
  }
  logEl.scrollTop = logEl.scrollHeight;
  statusEl.textContent = msg.message;
}

// ---- rendering -------------------------------------------------------------

function render(r) {
  statusEl.textContent = r.ok ? `Completed in ${(r.elapsedMs / 1000).toFixed(1)}s` : '';
  resultsEl.hidden = false;

  if (!r.ok) {
    resultsEl.innerHTML = `
      <div class="banner warn"><strong>No allocation produced.</strong> ${esc(r.error)}</div>
      ${r.failures?.length ? `<div class="panel"><h2>Sources that could not be read</h2><ul class="sources">${
        r.failures.map((f) => `<li>${esc(f.url)}<div class="meta">${esc(f.reason)}</div></li>`).join('')
      }</ul></div>` : ''}
      ${r.evidence?.length ? `<div class="panel"><h2>Instruments found but not priced</h2><ul class="sources">${
        r.evidence.slice(0, 20).map((e) => `<li>${esc(e.symbol)} — ${esc(e.name)}<div class="meta">${e.sourceCount} source(s)</div></li>`).join('')
      }</ul></div>` : ''}`;
    return;
  }

  resultsEl.innerHTML = [
    renderWarnings(r),
    renderVerdict(r),
    renderAllocation(r),
    renderValidation(r),
    renderRegime(r),
    renderCandidates(r),
    renderRejected(r),
    renderSources(r),
    renderProvenance(r),
  ].join('');
}

function renderWarnings(r) {
  if (!r.warnings?.length) return '';
  const simulated = r.simulatedData;
  return `<div class="banner ${simulated ? 'warn' : 'info'}">
    <strong>${simulated ? 'Read this first' : 'Notes on this run'}</strong>
    <ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
  </div>`;
}

function renderVerdict(r) {
  const p = r.portfolio;
  if (!p || !p.holdings.length) {
    return `<div class="verdict"><h2>Verdict</h2>
      <p class="headline">Nothing in the supplied material clears the risk limits for a ${esc(r.profile.label.toLowerCase())} mandate.</p>
      <p>That is a result, not a failure: the honest answer to "where should this money go?" is sometimes "not into any of these." Cash at ${pct(r.options.rf)} is the default alternative.</p></div>`;
  }

  const top = p.holdings[0];
  const topCandidate = r.candidates.find((c) => c.symbol === top.symbol);
  const names = p.holdings.map((h) => `<strong>${esc(h.symbol)}</strong> ${pct(h.weight, 0)}`).join(', ');

  return `<div class="verdict">
    <h2>Verdict</h2>
    <p class="headline">Best use of ${money(r.options.capital)} from these sources: ${names}${p.cash.weight > 0.02 ? `, with ${pct(p.cash.weight, 0)} in cash` : ''}.</p>
    <p>${esc(top.symbol)} takes the largest weight at ${pct(top.weight)} (${money(top.dollars)}) — ${esc(topCandidate?.thesis ?? '')}</p>
    <p>The blended portfolio carries an expected volatility of ${pct(p.expected.volatility)} against a ${pct(r.profile.maxPortfolioVol, 0)} budget, an ex-ante Sharpe of ${num(p.expected.sharpe)}, ${num(p.diagnostics.effectiveBets, 1)} effective independent bets, and an average pairwise correlation of ${num(p.diagnostics.averageCorrelation)}.</p>
    <p class="section-note">${esc(p.cash.rationale)}</p>
  </div>`;
}

function renderAllocation(r) {
  const p = r.portfolio;
  if (!p?.holdings.length) return '';
  const maxW = Math.max(...p.holdings.map((h) => h.weight));

  const rows = p.holdings.map((h) => `<tr>
    <td>${esc(h.symbol)} <span class="dim">${esc(h.name)}</span>${h.simulated ? ' <span class="tag sim">sim</span>' : ''}</td>
    <td>${esc(h.assetClassLabel)}</td>
    <td><div class="wcell"><span class="wbar" style="width:${(h.weight / maxW * 70).toFixed(1)}px"></span>${pct(h.weight)}</div></td>
    <td>${money(h.dollars)}</td>
    <td><div class="wcell"><span class="wbar risk" style="width:${(Math.max(0, h.riskContribution) * 70).toFixed(1)}px"></span>${pct(h.riskContribution, 0)}</div></td>
    <td>${pct(h.volatility)}</td>
    <td>${num(h.consensus)}</td>
    <td>${pct(h.conviction, 0)}</td>
  </tr>`).join('');

  const cashRow = p.cash.weight > 0.005 ? `<tr>
    <td>CASH <span class="dim">Cash / T-bills</span></td><td>Cash equivalents</td>
    <td><div class="wcell"><span class="wbar" style="width:${(p.cash.weight / maxW * 70).toFixed(1)}px"></span>${pct(p.cash.weight)}</div></td>
    <td>${money(p.cash.dollars)}</td><td class="dim">0%</td><td>0.0%</td><td class="dim">—</td><td class="dim">—</td>
  </tr>` : '';

  return `<h3 class="section">Recommended allocation</h3>
  <p class="section-lede">Weights come from blending four optimisers over a Ledoit–Wolf shrunk covariance matrix (shrinkage intensity ${num(p.diagnostics.shrinkageIntensity, 3)}), then tilting by committee conviction and capping each position at ${pct(p.diagnostics.maxWeightConstraint, 0)}.</p>
  <div class="panel"><div class="table-scroll"><table>
    <thead><tr><th>Position</th><th>Asset class</th><th>Weight</th><th>Amount</th><th>Risk share</th><th>Vol</th><th>Score</th><th>Conviction</th></tr></thead>
    <tbody>${rows}${cashRow}</tbody>
    <tfoot><tr><td>Total</td><td></td><td>100.0%</td><td>${money(r.options.capital)}</td><td>100%</td><td>${pct(p.expected.volatility)}</td><td></td><td></td></tr></tfoot>
  </table></div>
  <p class="section-note">Risk share is each position's contribution to total portfolio variance — the number that matters more than weight. A holding at 15% weight carrying 40% of the risk is a concentrated bet wearing a diversified label.</p>
  <p class="section-note">Optimiser blend for this mandate: ${Object.entries(p.blend).map(([k, v]) => `${esc(k)} ${pct(v, 0)}`).join(' · ')}. Individual solutions: ${
    Object.entries(p.solutions).map(([k, w]) => `<br><span class="dim">${esc(k)}:</span> ${p.matrices.symbols.map((s, i) => `${esc(s)} ${pct(w[i], 0)}`).join(', ')}`).join('')}</p>
  </div>
  ${renderCorrelation(p)}`;
}

function renderCorrelation(p) {
  const { correlation: c, symbols } = p.matrices;
  if (symbols.length < 2) return '';
  const cell = (v) => {
    const a = Math.abs(v);
    const colour = v >= 0 ? `rgba(242,119,122,${(a * 0.55).toFixed(2)})` : `rgba(78,201,160,${(a * 0.55).toFixed(2)})`;
    return `<td style="background:${colour}">${num(v)}</td>`;
  };
  return `<div class="panel"><h2>Correlation matrix</h2><div class="table-scroll"><table>
    <thead><tr><th></th>${symbols.map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead>
    <tbody>${symbols.map((s, i) => `<tr><td>${esc(s)}</td>${c[i].map(cell).join('')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="section-note">Red is positive correlation (moves together), green negative (offsets). Diversification lives in the pale cells; a matrix of deep red is one bet held under several names.</p></div>`;
}

function renderValidation(r) {
  const v = r.validation;
  if (!v?.backtest) return '';
  const rows = v.comparison.map((c) => `<tr>
    <td>${esc(c.name)}</td><td>${sign(c.cagr)}</td><td>${pct(c.vol)}</td>
    <td>${num(c.sharpe)}</td><td class="neg">${pct(c.maxDrawdown)}</td>
    <td>${num(c.finalMultiple)}×</td><td>${num(c.turnoverPerYear, 2)}</td>
  </tr>`).join('');

  const wf = v.walkForward;
  const mc = v.monteCarlo;

  return `<h3 class="section">Did the process actually work?</h3>
  <p class="section-lede">Three separate checks, in ascending order of honesty: an in-sample backtest, an out-of-sample walk-forward that re-fits on past data only, and a block-bootstrap of future outcomes.</p>
  <div class="panel">
    ${renderChart(v)}
    <div class="table-scroll"><table>
      <thead><tr><th>Portfolio</th><th>CAGR</th><th>Vol</th><th>Sharpe</th><th>Max DD</th><th>Growth</th><th>Turnover/yr</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="section-note">${esc(v.note)}</p>
    ${wf?.supported ? `<p class="section-note"><strong>Walk-forward (out of sample):</strong> ${wf.folds} refits over ${wf.observations} trading days produced ${sign(wf.metrics.cagr)} a year at ${pct(wf.metrics.annualVol)} volatility, Sharpe ${num(wf.metrics.sharpe)}, worst drawdown ${pct(wf.metrics.maxDrawdown)}. ${
      wf.metrics.sharpe < v.backtest.metrics.sharpe * 0.6
        ? 'That is materially worse than the in-sample figure, which is the expected signature of overfitting — trust the walk-forward number.'
        : 'That holds up reasonably against the in-sample figure, which is what you want to see.'}</p>` : `<p class="section-note"><strong>Walk-forward:</strong> not run — ${esc(wf?.reason ?? 'insufficient history')}.</p>`}
    ${mc ? `<p class="section-note"><strong>Monte Carlo (${mc.paths.toLocaleString()} block-bootstrapped paths, ${mc.horizonYears}-year horizon):</strong> median outcome ${num(mc.terminalMultiple.median)}× (${pct(mc.annualised.median)} a year), with a 5th percentile of ${num(mc.terminalMultiple.p5)}× and a 95th of ${num(mc.terminalMultiple.p95)}×. Probability of ending below where you started: ${pct(mc.probabilityOfLoss, 0)}. Median worst drawdown along the way: ${pct(mc.worstDrawdown.median)}.</p>` : ''}
  </div>`;
}

function renderChart(v) {
  const series = [
    { name: 'Recommended', data: v.backtest.equity, colour: '#5eb0ff' },
    { name: 'Equal weight', data: v.equalWeight?.equity, colour: '#8b97a8' },
  ].filter((s) => s.data?.length);
  if (v.walkForward?.supported) {
    series.push({ name: 'Walk-forward (out of sample)', data: v.walkForward.equity, colour: '#4ec9a0' });
  }
  if (!series.length) return '';

  const W = 900;
  const H = 260;
  const pad = { l: 46, r: 12, t: 12, b: 22 };
  const maxLen = Math.max(...series.map((s) => s.data.length));
  const all = series.flatMap((s) => s.data);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const x = (i, len) => pad.l + (i / Math.max(1, len - 1)) * (W - pad.l - pad.r);
  const y = (val) => pad.t + (1 - (val - lo) / Math.max(1e-9, hi - lo)) * (H - pad.t - pad.b);

  const paths = series.map((s) =>
    `<path d="${s.data.map((v2, i) => `${i ? 'L' : 'M'}${x(i, s.data.length).toFixed(1)},${y(v2).toFixed(1)}`).join('')}" fill="none" stroke="${s.colour}" stroke-width="1.6"/>`).join('');

  const ticks = [lo, lo + (hi - lo) / 2, hi].map((t) =>
    `<g><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="currentColor" stroke-opacity="0.12"/>
     <text x="4" y="${(y(t) + 4).toFixed(1)}" font-size="10" fill="currentColor" fill-opacity="0.5">${t.toFixed(2)}×</text></g>`).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Growth of one unit of capital">
    ${ticks}${paths}
  </svg>
  <div class="legend">${series.map((s) => `<span style="color:${s.colour}">${esc(s.name)}</span>`).join('')}</div>
  <p class="section-note">Growth of 1 unit of capital over ${maxLen} trading days of overlapping history, net of ${v.backtest.costBps} bps of trading cost per unit of turnover, rebalanced every ${v.backtest.rebalanceEvery} days.</p>`;
}

function renderRegime(r) {
  const g = r.regime;
  return `<div class="panel"><h2>Market regime</h2>
    <p style="margin:0 0 8px"><strong style="text-transform:capitalize">${esc(g.regime)}</strong> — ${esc(g.reason)}</p>
    <p class="section-note">Regime shifts the committee's factor weights: in stress the risk seat's vote is amplified and momentum discounted; in expansion the reverse. Confidence in this read: ${pct(g.confidence, 0)}.</p>
  </div>`;
}

function renderCandidates(r) {
  const accepted = r.candidates.filter((c) => !c.blocked);
  if (!accepted.length) return '';
  return `<h3 class="section">The committee, candidate by candidate</h3>
  <p class="section-lede">Five mandates score every name independently. Where they disagree, conviction falls — and dispersion between seats is reported rather than averaged away.</p>
  <div class="cards">${accepted.map((c, i) => renderCard(c, r, i === 0)).join('')}</div>`;
}

function renderRejected(r) {
  const rejected = r.candidates.filter((c) => c.blocked);
  if (!rejected.length) return '';
  return `<h3 class="section">Rejected on hard limits</h3>
  <p class="section-lede">These appeared in your sources and were excluded before optimisation. The reason is stated in full; disagree with it and you can change the limit in <code>server/quant/committee.js</code>.</p>
  <div class="cards">${rejected.map((c) => renderCard(c, r, false)).join('')}</div>`;
}

function renderCard(c, r, isTop) {
  const m = c.metrics;
  const cls = c.blocked ? 'card rejected' : isTop ? 'card top' : 'card';
  const metrics = [
    ['CAGR', sign(m.cagr)], ['Volatility', pct(m.annualVol)], ['Sharpe', num(m.sharpe)],
    ['Sortino', num(m.sortino)], ['Max drawdown', `<span class="neg">${pct(m.maxDrawdown)}</span>`],
    ['Calmar', num(m.calmar)], ['CVaR 95%', pct(m.cvar95, 2)], ['Skew', num(m.skew)],
    ['Excess kurtosis', num(m.excessKurtosis)], ['Prob. Sharpe', pct(m.psr, 0)],
    ['Deflated Sharpe', pct(m.deflatedSharpe, 0)], ['Hurst', num(m.hurst)],
    ...(c.market ? [['Beta', num(c.market.beta)], ['Alpha (ann.)', sign(c.market.alphaAnnual)],
      ['Alpha t-stat', num(c.market.alphaTStat)], ['Corr. to bench', num(c.market.correlation)],
      ['Up capture', pct(c.market.upCapture, 0)], ['Down capture', pct(c.market.downCapture, 0)]] : []),
  ];

  const votes = c.votes.map((v) => {
    const w = Math.min(50, Math.abs(v.score) / 3 * 50);
    const up = v.score >= 0;
    return `<div class="vote">
      <span class="who" title="${esc(v.mandate)}">${esc(v.name)}</span>
      <span class="track"><span class="mid"></span><span class="fill ${up ? 'up' : 'down'}" style="left:${up ? 50 : 50 - w}%;width:${w}%"></span></span>
      <span class="val ${up ? 'pos' : 'neg'}">${num(v.score)}</span>
    </div>`;
  }).join('');

  const ev = c.evidence;
  const sources = ev?.sources?.slice(0, 5).map((s) => `<li>
    <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.host)}</a>
    <div class="meta">${esc(s.host)} · ${esc(s.tier)} · credibility ${pct(s.credibility, 0)} · sentiment ${num(s.sentiment)} · ${esc(s.recency?.note ?? '')}${s.redFlags?.length ? ` · <span class="neg">${esc(s.redFlags.join(', '))}</span>` : ''}</div>
    ${s.quotes?.[0] ? `<div class="quote">…${esc(s.quotes[0])}…</div>` : ''}
  </li>`).join('') ?? '';

  return `<div class="${cls}">
    <div class="card-head">
      <h3><span class="sym">${esc(c.symbol)}</span> ${esc(c.name)}
        <span class="tag ${esc(c.recommendation)}">${esc(c.recommendation)}</span>
        ${c.simulated ? '<span class="tag sim">simulated data</span>' : ''}
      </h3>
      <div class="dim">consensus ${num(c.consensus)} · conviction ${pct(c.conviction, 0)} · dispersion ${num(c.dispersion)}</div>
    </div>
    <div class="card-sub">${esc(c.assetClassLabel)}${c.singleName ? ' · single-name idiosyncratic risk' : ''} · ${m.observations} observations from ${esc(c.firstDate)} to ${esc(c.lastDate)} · ${esc(c.dataSourceLabel)}</div>

    <p class="thesis">${esc(c.thesis)}</p>

    <div class="metric-grid">${metrics.map(([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>

    <div class="votes">${votes}</div>

    ${c.factors ? `<p class="section-note"><strong>Return attribution:</strong> ${
      Object.entries(c.factors.loadings)
        .sort((a, b) => Math.abs(b[1].beta) - Math.abs(a[1].beta))
        .map(([k, v]) => `${esc(k)} ${num(v.beta)}${Math.abs(v.tStat) > 2 ? '' : '<span class="dim"> (n.s.)</span>'}`)
        .join(' · ')
    } — these exposures explain ${pct(c.factors.r2, 0)} of its variance, leaving ${sign(c.factors.alphaAnnual)} a year unexplained (t = ${num(c.factors.alphaTStat)})${
      Math.abs(c.factors.alphaTStat) < 2 ? ', which is not statistically distinguishable from zero' : ''}.</p>` : ''}

    ${c.vetoes.length ? `<ul class="vetoes">${c.vetoes.map((v) => `<li class="${esc(v.severity)}">
      <div class="who">${esc(v.seatName)} · ${esc(v.severity === 'blocking' ? 'hard limit' : 'flag')}</div>${esc(v.reason)}</li>`).join('')}</ul>` : ''}

    ${sources ? `<ul class="sources">${sources}</ul>` : ''}
  </div>`;
}

function renderSources(r) {
  if (!r.documents?.length && !r.failures?.length) return '';
  const docs = r.documents.map((d) => `<tr>
    <td><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc((d.title || d.url).slice(0, 70))}</a></td>
    <td>${esc(d.host || d.kind)}</td><td>${esc(d.sourceTier.label)}</td>
    <td>${d.wordCount.toLocaleString()}</td><td>${pct(d.credibility, 0)}</td>
    <td>${pct(d.rigour.rigourScore, 0)}</td>
    <td class="${d.hype.hypeScore > 0.4 ? 'neg' : ''}">${pct(d.hype.hypeScore, 0)}</td>
    <td>${num(d.sentiment.score)}</td><td>${esc(d.stance.stance)}</td>
    <td>${d.instruments.slice(0, 5).map((i) => esc(i.symbol)).join(' ') || '—'}</td>
  </tr>`).join('');

  return `<h3 class="section">How each source was read</h3>
  <p class="section-lede">Credibility combines the domain's editorial prior with what the page actually does: citing filings, quantifying risk and naming the bear case raise it; promotional language and manufactured urgency sink it.</p>
  <div class="panel"><div class="table-scroll"><table>
    <thead><tr><th>Source</th><th>Host</th><th>Tier</th><th>Words</th><th>Credibility</th><th>Rigour</th><th>Hype</th><th>Sentiment</th><th>Stance</th><th>Instruments</th></tr></thead>
    <tbody>${docs}</tbody>
  </table></div>
  ${r.failures?.length ? `<p class="section-note"><strong>Could not read:</strong> ${r.failures.map((f) => `${esc(f.url)} (${esc(f.reason)})`).join('; ')}</p>` : ''}
  </div>`;
}

function renderProvenance(r) {
  const p = r.dataProvenance;
  return `<div class="panel"><h2>Data provenance</h2>
    <p class="section-note">Price history: ${p.bySource.map((s) => `${s.count} × ${esc(s.label)}`).join(', ') || 'none'}. Benchmark ${esc(p.benchmark.symbol)}: ${esc(p.benchmark.label)}.
    Analysis run ${esc(new Date(r.generatedAt).toLocaleString())} in ${(r.elapsedMs / 1000).toFixed(1)}s.
    Risk-free rate assumed ${pct(r.options.rf)}. Mandate: ${esc(r.profile.label)}.</p>
    ${r.unpriced?.length ? `<p class="section-note"><strong>Mentioned but not analysed:</strong> ${r.unpriced.map((u) => `${esc(u.symbol)} (${esc(u.reason)})`).join(', ')}.</p>` : ''}
  </div>`;
}
