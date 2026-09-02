// A working vocabulary of instruments and the words that look like tickers but
// are not. Extraction without this list produces a candidate named "CEO".

/** Common tickers mapped to name and asset class, used to validate extractions. */
export const KNOWN = {
  // Broad-market and factor ETFs
  SPY: ['SPDR S&P 500 ETF', 'equity-index'], VOO: ['Vanguard S&P 500 ETF', 'equity-index'],
  IVV: ['iShares Core S&P 500 ETF', 'equity-index'], VTI: ['Vanguard Total Stock Market ETF', 'equity-index'],
  QQQ: ['Invesco QQQ (Nasdaq-100)', 'equity-index'], DIA: ['SPDR Dow Jones Industrial Average ETF', 'equity-index'],
  IWM: ['iShares Russell 2000 ETF', 'equity-index'], MDY: ['SPDR S&P MidCap 400 ETF', 'equity-index'],
  RSP: ['Invesco S&P 500 Equal Weight ETF', 'equity-index'], VT: ['Vanguard Total World Stock ETF', 'equity-index'],
  VEA: ['Vanguard Developed Markets ETF', 'equity-intl'], VWO: ['Vanguard Emerging Markets ETF', 'equity-intl'],
  EFA: ['iShares MSCI EAFE ETF', 'equity-intl'], EEM: ['iShares MSCI Emerging Markets ETF', 'equity-intl'],
  VXUS: ['Vanguard Total International Stock ETF', 'equity-intl'],
  MTUM: ['iShares MSCI USA Momentum Factor ETF', 'equity-factor'],
  VLUE: ['iShares MSCI USA Value Factor ETF', 'equity-factor'],
  QUAL: ['iShares MSCI USA Quality Factor ETF', 'equity-factor'],
  USMV: ['iShares MSCI USA Min Vol Factor ETF', 'equity-factor'],
  SPLV: ['Invesco S&P 500 Low Volatility ETF', 'equity-factor'],
  VIG: ['Vanguard Dividend Appreciation ETF', 'equity-dividend'],
  VYM: ['Vanguard High Dividend Yield ETF', 'equity-dividend'],
  SCHD: ['Schwab US Dividend Equity ETF', 'equity-dividend'],
  NOBL: ['ProShares S&P 500 Dividend Aristocrats', 'equity-dividend'],

  // Sectors
  XLK: ['Technology Select Sector SPDR', 'equity-sector'], XLF: ['Financial Select Sector SPDR', 'equity-sector'],
  XLE: ['Energy Select Sector SPDR', 'equity-sector'], XLV: ['Health Care Select Sector SPDR', 'equity-sector'],
  XLI: ['Industrial Select Sector SPDR', 'equity-sector'], XLP: ['Consumer Staples Select Sector SPDR', 'equity-sector'],
  XLY: ['Consumer Discretionary Select Sector SPDR', 'equity-sector'], XLU: ['Utilities Select Sector SPDR', 'equity-sector'],
  XLB: ['Materials Select Sector SPDR', 'equity-sector'], XLRE: ['Real Estate Select Sector SPDR', 'equity-sector'],
  XLC: ['Communication Services Select Sector SPDR', 'equity-sector'],
  SMH: ['VanEck Semiconductor ETF', 'equity-sector'], SOXX: ['iShares Semiconductor ETF', 'equity-sector'],

  // Fixed income
  AGG: ['iShares Core US Aggregate Bond ETF', 'bond'], BND: ['Vanguard Total Bond Market ETF', 'bond'],
  TLT: ['iShares 20+ Year Treasury Bond ETF', 'bond-long'], IEF: ['iShares 7-10 Year Treasury Bond ETF', 'bond'],
  SHY: ['iShares 1-3 Year Treasury Bond ETF', 'bond-short'], BIL: ['SPDR 1-3 Month T-Bill ETF', 'cash'],
  SGOV: ['iShares 0-3 Month Treasury Bond ETF', 'cash'], TIP: ['iShares TIPS Bond ETF', 'bond-inflation'],
  LQD: ['iShares Investment Grade Corporate Bond ETF', 'bond-credit'],
  HYG: ['iShares High Yield Corporate Bond ETF', 'bond-credit'],
  JNK: ['SPDR Bloomberg High Yield Bond ETF', 'bond-credit'],
  MUB: ['iShares National Muni Bond ETF', 'bond-muni'],

  // Real assets and alternatives
  GLD: ['SPDR Gold Shares', 'commodity'], IAU: ['iShares Gold Trust', 'commodity'],
  SLV: ['iShares Silver Trust', 'commodity'], DBC: ['Invesco DB Commodity Index', 'commodity'],
  USO: ['United States Oil Fund', 'commodity'], PDBC: ['Invesco Optimum Yield Commodity', 'commodity'],
  VNQ: ['Vanguard Real Estate ETF', 'real-estate'], SCHH: ['Schwab US REIT ETF', 'real-estate'],
  BITO: ['ProShares Bitcoin Strategy ETF', 'crypto'], IBIT: ['iShares Bitcoin Trust', 'crypto'],
  FBTC: ['Fidelity Wise Origin Bitcoin Fund', 'crypto'], GBTC: ['Grayscale Bitcoin Trust', 'crypto'],
  ETHE: ['Grayscale Ethereum Trust', 'crypto'],

  // Large caps commonly written about
  AAPL: ['Apple', 'equity-single'], MSFT: ['Microsoft', 'equity-single'], GOOGL: ['Alphabet', 'equity-single'],
  GOOG: ['Alphabet Class C', 'equity-single'], AMZN: ['Amazon', 'equity-single'], NVDA: ['NVIDIA', 'equity-single'],
  META: ['Meta Platforms', 'equity-single'], TSLA: ['Tesla', 'equity-single'], BRK: ['Berkshire Hathaway', 'equity-single'],
  'BRK-B': ['Berkshire Hathaway Class B', 'equity-single'], JPM: ['JPMorgan Chase', 'equity-single'],
  V: ['Visa', 'equity-single'], MA: ['Mastercard', 'equity-single'], UNH: ['UnitedHealth', 'equity-single'],
  JNJ: ['Johnson & Johnson', 'equity-single'], XOM: ['Exxon Mobil', 'equity-single'], CVX: ['Chevron', 'equity-single'],
  WMT: ['Walmart', 'equity-single'], PG: ['Procter & Gamble', 'equity-single'], HD: ['Home Depot', 'equity-single'],
  KO: ['Coca-Cola', 'equity-single'], PEP: ['PepsiCo', 'equity-single'], COST: ['Costco', 'equity-single'],
  AVGO: ['Broadcom', 'equity-single'], AMD: ['Advanced Micro Devices', 'equity-single'], INTC: ['Intel', 'equity-single'],
  CRM: ['Salesforce', 'equity-single'], ADBE: ['Adobe', 'equity-single'], NFLX: ['Netflix', 'equity-single'],
  DIS: ['Walt Disney', 'equity-single'], BAC: ['Bank of America', 'equity-single'], WFC: ['Wells Fargo', 'equity-single'],
  GS: ['Goldman Sachs', 'equity-single'], MS: ['Morgan Stanley', 'equity-single'], PFE: ['Pfizer', 'equity-single'],
  MRK: ['Merck', 'equity-single'], LLY: ['Eli Lilly', 'equity-single'], ABBV: ['AbbVie', 'equity-single'],
  T: ['AT&T', 'equity-single'], VZ: ['Verizon', 'equity-single'], CSCO: ['Cisco', 'equity-single'],
  ORCL: ['Oracle', 'equity-single'], IBM: ['IBM', 'equity-single'], QCOM: ['Qualcomm', 'equity-single'],
  TXN: ['Texas Instruments', 'equity-single'], MU: ['Micron', 'equity-single'], PLTR: ['Palantir', 'equity-single'],
  UBER: ['Uber', 'equity-single'], COIN: ['Coinbase', 'equity-single'], SQ: ['Block', 'equity-single'],
  PYPL: ['PayPal', 'equity-single'], SHOP: ['Shopify', 'equity-single'], MSTR: ['MicroStrategy', 'equity-single'],
  GME: ['GameStop', 'equity-single'], AMC: ['AMC Entertainment', 'equity-single'], F: ['Ford', 'equity-single'],
  GM: ['General Motors', 'equity-single'], BA: ['Boeing', 'equity-single'], CAT: ['Caterpillar', 'equity-single'],
  MCD: ['McDonalds', 'equity-single'], NKE: ['Nike', 'equity-single'], SBUX: ['Starbucks', 'equity-single'],
  RIVN: ['Rivian', 'equity-single'], LCID: ['Lucid Group', 'equity-single'], SOFI: ['SoFi Technologies', 'equity-single'],
  HOOD: ['Robinhood', 'equity-single'], ARKK: ['ARK Innovation ETF', 'equity-thematic'],
  SMCI: ['Super Micro Computer', 'equity-single'], DELL: ['Dell Technologies', 'equity-single'],
};

/** Company and fund names that should resolve to a ticker when written out. */
export const NAME_TO_TICKER = (() => {
  const map = new Map();
  for (const [ticker, [name]] of Object.entries(KNOWN)) {
    map.set(name.toLowerCase(), ticker);
  }
  const aliases = {
    'apple inc': 'AAPL', 'alphabet inc': 'GOOGL', google: 'GOOGL', 'amazon.com': 'AMZN',
    nvidia: 'NVDA', facebook: 'META', 'meta platforms inc': 'META', 'berkshire hathaway': 'BRK-B',
    'the s&p 500': 'SPY', 's&p 500': 'SPY', 'sp500': 'SPY', 'the nasdaq': 'QQQ', 'nasdaq 100': 'QQQ',
    'nasdaq-100': 'QQQ', 'total stock market': 'VTI', 'russell 2000': 'IWM',
    'long-term treasuries': 'TLT', 'long term treasuries': 'TLT', treasuries: 'IEF',
    'treasury bills': 'BIL', 't-bills': 'BIL', gold: 'GLD', silver: 'SLV', bitcoin: 'IBIT',
    ethereum: 'ETHE', 'emerging markets': 'VWO', 'developed markets': 'VEA',
    'total bond market': 'BND', 'aggregate bond': 'AGG', reits: 'VNQ', 'real estate': 'VNQ',
    'high yield bonds': 'HYG', 'junk bonds': 'HYG', 'corporate bonds': 'LQD', tips: 'TIP',
    'dividend aristocrats': 'NOBL', 'equal weight s&p': 'RSP', semiconductors: 'SMH',
  };
  for (const [k, v] of Object.entries(aliases)) map.set(k, v);
  return map;
})();

/**
 * Uppercase words that appear constantly in financial writing and are not
 * tickers. Without this the extractor returns "The CEO said the ETF's IRR".
 */
export const TICKER_STOPWORDS = new Set([
  'A', 'I', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'IF', 'IN', 'IS', 'IT', 'ME', 'MY', 'NO',
  'OF', 'ON', 'OR', 'SO', 'TO', 'UP', 'US', 'WE', 'AM', 'PM', 'AND', 'THE', 'FOR', 'BUT', 'NOT',
  'YOU', 'ALL', 'CAN', 'HAS', 'HAD', 'WAS', 'ARE', 'OUR', 'OUT', 'NEW', 'NOW', 'ONE', 'TWO', 'WHY',
  'HOW', 'WHO', 'ITS', 'MAY', 'GET', 'SEE', 'USE', 'DAY', 'OWN', 'TOP', 'BIG', 'LOW', 'HIGH',
  'CEO', 'CFO', 'COO', 'CTO', 'IPO', 'ETF', 'ETFS', 'IRA', 'ROTH', 'HSA', 'GDP', 'CPI', 'PPI',
  'FED', 'FOMC', 'SEC', 'IRS', 'FDIC', 'FINRA', 'NYSE', 'AMEX', 'OTC', 'ADR', 'REIT', 'REITS',
  'EPS', 'PE', 'PEG', 'EBITDA', 'EBIT', 'ROE', 'ROA', 'ROI', 'ROIC', 'IRR', 'NPV', 'DCF', 'FCF',
  'YTD', 'YOY', 'QOQ', 'MOM', 'TTM', 'LTM', 'CAGR', 'APR', 'APY', 'AUM', 'NAV', 'BPS', 'YTM',
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'CHF', 'BTC', 'ETH',
  'USA', 'UK', 'EU', 'ECB', 'BOJ', 'IMF', 'OPEC', 'NATO', 'GAAP', 'SPAC', 'LLC', 'LLP', 'INC',
  'AI', 'ML', 'API', 'URL', 'HTTP', 'HTML', 'FAQ', 'PDF', 'CSV', 'TLDR', 'DYOR', 'NFA', 'IMO',
  'YOLO', 'FOMO', 'HODL', 'ATH', 'DD', 'PS', 'PPS', 'EV', 'TAM', 'SAM', 'ARR', 'MRR', 'SAAS',
  'Q1', 'Q2', 'Q3', 'Q4', 'FY', 'H1', 'H2', 'VIX', 'VAR', 'CVAR', 'MC', 'ESG', 'SPY500',
  'BUY', 'SELL', 'HOLD', 'LONG', 'SHORT', 'CALL', 'PUT', 'BULL', 'BEAR', 'RISK', 'CASH',
  'MUST', 'BEST', 'WORST', 'FREE', 'MORE', 'LESS', 'THAN', 'THAT', 'THIS', 'WITH', 'FROM',
  'WILL', 'WHAT', 'WHEN', 'YOUR', 'THEY', 'HAVE', 'BEEN', 'JUST', 'ONLY', 'ALSO', 'OVER',
  'INTO', 'MOST', 'SOME', 'SUCH', 'THEN', 'THEM', 'MADE', 'MAKE', 'TIME', 'YEAR', 'WEEK',
  'PLAN', 'FUND', 'RATE', 'RATES', 'BOND', 'BONDS', 'GOLD', 'OIL', 'GAS', 'TECH', 'BANK',
]);

/** Asset class metadata used for diversification checks and display. */
export const ASSET_CLASS_LABELS = {
  'equity-index': 'Broad equity index',
  'equity-intl': 'International equity',
  'equity-factor': 'Factor equity',
  'equity-dividend': 'Dividend equity',
  'equity-sector': 'Sector equity',
  'equity-thematic': 'Thematic equity',
  'equity-single': 'Single stock',
  bond: 'Investment-grade bonds',
  'bond-long': 'Long-duration government bonds',
  'bond-short': 'Short-duration government bonds',
  'bond-credit': 'Credit / high yield',
  'bond-inflation': 'Inflation-linked bonds',
  'bond-muni': 'Municipal bonds',
  cash: 'Cash equivalents',
  commodity: 'Commodities',
  'real-estate': 'Real estate',
  crypto: 'Digital assets',
  unknown: 'Unclassified',
};

export function classify(symbol) {
  const entry = KNOWN[symbol.toUpperCase()];
  return entry ? entry[1] : 'unknown';
}

export function describe(symbol) {
  const entry = KNOWN[symbol.toUpperCase()];
  return entry ? entry[0] : symbol.toUpperCase();
}

/** Single-stock exposure carries idiosyncratic risk a fund does not. */
export function isSingleName(symbol) {
  return classify(symbol) === 'equity-single';
}
