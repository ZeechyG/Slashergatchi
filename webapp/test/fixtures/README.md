# Test fixtures

**`prices/*.csv` are SIMULATED price series, not real market data.** They are
generated deterministically by `syntheticSeries()` so the test suite exercises
the maths without depending on a live provider, and they are pointed at only via
`PRICE_FIXTURE_DIR` inside tests. Nothing here is used by the running
application, and no conclusion drawn from them means anything about the real
instruments whose tickers they borrow.

`docs/*.html` are synthetic source documents written for the test suite: one
piece of rigorous research, one fund page, and one deliberately promotional
pitch, used to verify that the credibility scoring separates them.
