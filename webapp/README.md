# Capital Allocator

A web app that reads the URLs you have been reading — articles, fund pages,
filings, YouTube videos — works out what is actually being recommended in them,
prices every candidate, and puts the result through the process an investment
committee would run before allocating money.

It is deliberately not a chatbot with an opinion. Every number on the page comes
from a documented calculation in `server/quant/`, and the reasoning for each
decision is shown next to it.

```bash
cd webapp
npm start              # no dependencies to install — Node 18+ only
# open http://127.0.0.1:3000
npm test               # 46 tests over the maths and the ingestion layer
```

---

## What it does, in order

### 1. Reads the sources

Fetching happens server-side, because a browser cannot fetch arbitrary URLs
(CORS) and because doing it naively on a server is an SSRF hole. `ingest/fetcher.js`
re-vets **every redirect hop** against loopback, link-local, private and
carrier-grade-NAT ranges, refuses non-HTTP schemes, caps the body at 3 MB and
times out at 15 s.

- **HTML** is reduced to article text (`<article>`/`<main>` preferred, scripts and
  navigation stripped), with title, author and publication date pulled from meta
  tags and JSON-LD.
- **YouTube** URLs get the player response parsed out of the watch page for
  title, channel and description, then the timed-text endpoint is tried for a
  real transcript. When no transcript exists, the app says so rather than
  pretending it watched the video.
- **Paywalled pages and PDFs** can be pasted in directly. Separate documents with
  a line containing only `---` so each keeps its own credibility score.

### 2. Reads each document like an analyst

`ingest/extract.js` pulls out, per document:

| Signal | How |
| --- | --- |
| **Instruments** | Cashtags (`$NVDA`), exchange-qualified tickers (`NASDAQ: AAPL`), parenthetical tickers, known-universe symbols, and company names in prose. Each carries an extraction confidence. |
| **Sentiment** | A finance-specific lexicon with negation and intensifier handling — generic sentiment models read "bear" and "cheap" backwards. |
| **Promotional language** | 16 red-flag patterns: guaranteed returns, manufactured urgency, referral links, "the next Tesla", all-in advocacy, downplayed leverage. |
| **Analytical rigour** | Markers of real work: cited filings, an explicit bear case, disclosed positions, quantified risk, numeric density. |
| **Credibility** | `0.45 × domain prior + 0.35 × rigour + 0.2 × recency − 0.5 × hype`. |

A 200-word ticker vocabulary of stopwords (`CEO`, `ETF`, `GDP`, `EPS`, `SEC`…)
keeps the extractor from proposing an investment in "IRR".

Mentions are then rolled up per instrument, weighted by each source's
credibility × how prominently the name featured, and corroboration across
*independent hosts* counts for more than repetition.

### 3. Prices everything

`data/marketdata.js` runs a provider chain — **Stooq → Yahoo → local fixtures →
(optional) simulated** — with a 6-hour disk cache. Every series carries its
`source` label all the way to the UI, because an allocation built on real prices
and one built on a fallback are not the same claim.

Simulated history is **off by default**, must be explicitly enabled, and when
used it is labelled on the candidate card, in the provenance panel, and in a
banner at the top of the results.

You can also supply your own CSV (`date,SYMBOL,SYMBOL…` or `date,symbol,close`).

### 4. Runs the numbers

Every candidate gets the full sheet (`quant/metrics.js`, `quant/regression.js`):

- **Return/risk** — CAGR, annualised volatility, Sharpe, Sortino, Calmar, Omega
- **Drawdown** — maximum, current, longest underwater stretch, recovery status, Ulcer index
- **Tails** — historical VaR, expected shortfall (CVaR), Cornish–Fisher modified
  VaR, skew, excess kurtosis, tail ratio
- **Statistical honesty** — Probabilistic Sharpe (is the record long enough to
  believe?), **Deflated Sharpe** (adjusted for the fact that you hand-picked this
  list), t-statistic and p-value of the mean
- **Structure** — Hurst exponent, lag-1 autocorrelation, volatility regime
- **Benchmark-relative** — alpha with its t-statistic, beta, R², tracking error,
  information ratio, up/down capture, and correlation *conditional on the
  benchmark's worst decile of days*

### 5. Convenes the committee

Five seats (`quant/committee.js`), each with its own factor weights, its own
mandate and its own veto:

| Seat | Mandate |
| --- | --- |
| Systematic / Quant PM | Persistent, testable risk premia. Trusts the cross-section, distrusts stories. |
| Fundamental / Value PM | Assets priced below what their cash flows justify. Will not pay up for momentum. |
| Chief Risk Officer | Owns the downside. Sizes to what the portfolio can survive. |
| Macro / Cross-Asset | Thinks in regimes and correlations. Values what behaves differently. |
| Research Diligence | Judges the source, not the ticker. Discounts anything with a sales pitch attached. |

Factors are grouped into five families (momentum, quality, risk, value,
diversification) and cross-sectionally winsorised and z-scored, so families are
comparable and one outlier cannot dominate. Weights are tilted by the detected
**market regime** (`quant/regime.js`): in stress the risk seat gets louder, in
expansion momentum earns more of a say.

Ten hard limits are evaluated per candidate — insufficient history, catastrophic
drawdown, fat left tail, no statistical edge, promotional source, single weak
source, redundant-with-benchmark, stale data. A **blocking** veto rejects the
candidate outright and the reason is printed in full.

Dispersion between seats is reported, not averaged away: **conviction falls when
the committee disagrees**, and that is a different quantity from the score.

### 6. Builds the portfolio

Four optimisers run over one Ledoit–Wolf shrunk covariance matrix (constant-
correlation target, intensity estimated from the data), then are blended
according to the risk mandate:

| | Conservative | Balanced | Aggressive |
| --- | --- | --- | --- |
| Max Sharpe | 12% | 34% | 60% |
| Risk parity | 35% | 28% | 16% |
| HRP | 25% | 24% | 18% |
| Min variance | 28% | 14% | 6% |
| Vol budget | 11% | 16% | 24% |
| Max position | 30% | 40% | 50% |

Then:

- **Expected returns are shrunk hard** (35% historical / 65% cross-sectional mean)
  and tilted by at most ±60 bp of committee view. Mean-variance optimisation is
  notoriously hostage to return estimates; this is the mitigation.
- **Redundant exposures are pruned.** Two names correlated above 0.97 are one bet
  under two tickers — the lower-scoring twin is dropped and the reason reported.
- **Volatility is targeted with cash**, not by forcing the risky sleeve to be
  something it is not. Fractional-Kelly sizing sets the risky share.
- Positions below 2% are dropped as dust.

### 7. Checks whether the process actually worked

Three tests in ascending order of honesty (`quant/backtest.js`):

1. **In-sample backtest** — the recommended weights on the history used to pick
   them, net of trading costs. Descriptive, not predictive, and labelled as such.
2. **Walk-forward** — the whole construction process re-fitted on expanding
   in-sample windows, measuring only the out-of-sample periods that follow. The
   page says outright when this is materially worse than the in-sample figure.
3. **Monte Carlo** — 2,000 block-bootstrapped paths (blocks preserve
   autocorrelation), reported as a distribution with a 5th and 95th percentile,
   never a point estimate.

An **equal-weight portfolio of the same names** is always shown alongside. If the
machinery cannot beat equal weight, you should be able to see that.

---

## Limits, stated plainly

- **No fundamental data.** No earnings, balance sheets, expense ratios, tax
  treatment or liquidity enter the model unless they appear in the text you
  supplied. Valuation factors use price-based mean-reversion proxies.
- **Historical statistics are estimates with wide error bars.** That is why the
  Probabilistic and Deflated Sharpe ratios are shown: they quantify exactly how
  much of the track record could be luck.
- **Text is read heuristically.** Lexicon sentiment and pattern-matched red flags
  are transparent and inspectable, which was chosen over an opaque model that
  would be more accurate on average and impossible to audit when wrong.
- **Survivorship and selection bias live in your URL list.** The tool can only
  analyse what you gave it; the Deflated Sharpe adjustment is a partial defence,
  not a cure.
- **This is not investment advice**, and it is not a substitute for a licensed
  adviser who knows your tax position, liabilities and time horizon.

## Layout

```
server/
  index.js            HTTP + NDJSON progress streaming
  pipeline.js         orchestration
  ingest/             fetcher (SSRF-guarded), HTML, YouTube, extraction, lexicons
  data/               provider chain, instrument universe
  quant/
    mathx.js          statistics, distributions, linear algebra
    series.js         alignment, returns, resampling
    metrics.js        the risk/return battery
    regression.js     market model, factor model, correlation stability
    factors.js        cross-sectional factor panel
    regime.js         market regime detection
    committee.js      the five seats, vetoes, consensus
    portfolio.js      shrinkage, max-Sharpe, risk parity, HRP, min-variance
    backtest.js       simulation, walk-forward, Monte Carlo
public/               single-page frontend, no framework
test/                 46 tests
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address — loopback by default |
| `PRICE_FIXTURE_DIR` | `fixtures/prices` | Offline CSV fallback location |
