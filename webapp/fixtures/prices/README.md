# Offline price fixtures

Drop end-of-day CSV files here named `SYMBOL.csv` (for example `VTI.csv`) with a
header row containing at least `Date` and `Close` columns:

```
Date,Open,High,Low,Close,Volume
2019-01-02,...,...,...,241.57,...
```

They are used **only when the live providers (Stooq, Yahoo) fail**, so a stale
file can never silently shadow real market data. Set `PRICE_FIXTURE_DIR` to read
them from somewhere else.

Series shorter than 120 observations are rejected: there is no honest way to
estimate volatility, drawdown or correlation from less.
