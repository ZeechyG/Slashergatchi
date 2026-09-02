// Domain lexicons. Generic sentiment models mis-read financial prose ("bear"
// is not an animal, "cheap" is a compliment, "guaranteed returns" is a siren).
// These lists are tuned for investment writing specifically.

/** Words that carry a directional view, weighted by strength. */
export const SENTIMENT = {
  positive: {
    undervalued: 1.0, cheap: 0.7, bargain: 0.9, discount: 0.6, attractive: 0.7,
    outperform: 0.9, outperforming: 0.8, beat: 0.6, beats: 0.6, upside: 0.8,
    growth: 0.4, growing: 0.4, expanding: 0.4, accelerating: 0.6, momentum: 0.5,
    strong: 0.6, robust: 0.6, resilient: 0.6, durable: 0.6, quality: 0.5,
    moat: 0.8, competitive: 0.4, profitable: 0.7, margin: 0.3, margins: 0.3,
    dividend: 0.4, buyback: 0.5, buybacks: 0.5, 'free cash flow': 0.6,
    bullish: 0.9, bull: 0.6, rally: 0.6, breakout: 0.6, upgrade: 0.8, upgraded: 0.8,
    overweight: 0.7, accumulate: 0.6, compounding: 0.6, compounder: 0.8,
    undervaluation: 0.9, mispriced: 0.6, oversold: 0.5, recovery: 0.5,
  },
  negative: {
    overvalued: -1.0, expensive: -0.7, stretched: -0.7, frothy: -0.9, bubble: -1.0,
    underperform: -0.9, underperforming: -0.8, miss: -0.6, missed: -0.6, downside: -0.8,
    declining: -0.7, shrinking: -0.7, decelerating: -0.6, deteriorating: -0.9,
    weak: -0.6, fragile: -0.7, risky: -0.5, risk: -0.2, volatile: -0.4,
    debt: -0.4, leveraged: -0.5, dilution: -0.8, diluted: -0.6, impairment: -0.8,
    bearish: -0.9, bear: -0.6, crash: -1.0, selloff: -0.7, breakdown: -0.7,
    downgrade: -0.8, downgraded: -0.8, underweight: -0.7, avoid: -0.9, sell: -0.6,
    bankruptcy: -1.2, insolvency: -1.2, fraud: -1.2, investigation: -0.8,
    lawsuit: -0.6, litigation: -0.6, recall: -0.6, layoffs: -0.5, restructuring: -0.5,
    overbought: -0.5, correction: -0.5, recession: -0.7, headwind: -0.6, headwinds: -0.6,
  },
  negators: ['not', 'no', 'never', "isn't", "wasn't", "aren't", "doesn't", "didn't", "won't", 'without', 'hardly', 'barely'],
  intensifiers: { very: 1.4, extremely: 1.7, highly: 1.4, deeply: 1.5, significantly: 1.4, slightly: 0.6, somewhat: 0.6, modestly: 0.6 },
};

/**
 * Promotional and manipulation patterns. These are the phrases that separate
 * research from a sales pitch, and every one of them is a reason to discount
 * the source rather than the asset.
 */
export const RED_FLAGS = [
  { re: /\bguarantee(d|s)?\s+(returns?|profits?|income|gains?)\b/i, weight: 1.0, label: 'guarantees returns' },
  { re: /\b(risk[- ]free|no[- ]risk|zero[- ]risk)\s+(returns?|profit|investment|money)\b/i, weight: 1.0, label: 'claims risk-free returns' },
  { re: /\bcan'?t\s+lose\b/i, weight: 1.0, label: 'claims you cannot lose' },
  { re: /\bto\s+the\s+moon\b|\b🚀{2,}/i, weight: 0.7, label: 'hype language ("to the moon")' },
  { re: /\b(100x|1000x|10x)\s+(your\s+)?(money|returns?|gains?|portfolio)\b/i, weight: 0.9, label: 'promises extreme multiples' },
  { re: /\b(get\s+rich|financial\s+freedom|quit\s+your\s+job|retire\s+early)\b.{0,40}\b(fast|quick|now|month|week|year)\b/i, weight: 0.8, label: 'get-rich-quick framing' },
  { re: /\b(secret|hidden|nobody\s+is\s+talking\s+about|wall\s+street\s+doesn'?t\s+want)\b/i, weight: 0.7, label: 'appeals to secret knowledge' },
  { re: /\b(act\s+now|limited\s+time|before\s+it'?s\s+too\s+late|last\s+chance|closing\s+soon)\b/i, weight: 0.8, label: 'manufactured urgency' },
  { re: /\b(sign\s+up|join)\s+(my|our)\s+(discord|telegram|patreon|newsletter|course|group|community)\b/i, weight: 0.7, label: 'funnels to a paid community' },
  { re: /\b(use\s+my|my)\s+(referral|affiliate)\s+(link|code)\b|\bpromo\s+code\b/i, weight: 0.8, label: 'affiliate or referral incentive' },
  { re: /\bnext\s+(tesla|nvidia|amazon|apple|bitcoin)\b/i, weight: 0.7, label: 'the-next-big-thing comparison' },
  { re: /\b(all\s+in|yolo|bet\s+the\s+farm|mortgage\s+your)\b/i, weight: 0.9, label: 'advocates undiversified all-in bets' },
  { re: /\b(pump|squeeze)\b.{0,30}\b(coming|incoming|imminent)\b/i, weight: 0.9, label: 'anticipates a squeeze or pump' },
  { re: /\bmillionaire\s+by\b|\b\$?\d+[km]?\s+(a|per)\s+(month|week|day)\s+(passive|guaranteed)\b/i, weight: 0.8, label: 'income promises' },
  { re: /\b(leverage|margin|options)\b.{0,40}\b(easy|simple|safe|guaranteed)\b/i, weight: 0.9, label: 'downplays leverage risk' },
  { re: /\bdon'?t\s+miss\s+(out|this)\b/i, weight: 0.6, label: 'FOMO appeal' },
];

/**
 * Marks of genuine analysis. A page that discloses positions, cites data and
 * names the bear case gets credit for it.
 */
export const CREDIBILITY_MARKERS = [
  { re: /\b(risk|risks)\s+(include|to\s+(the\s+)?thesis|factors?)\b/i, weight: 0.5, label: 'states risks to the thesis' },
  { re: /\bbear\s+case\b|\bcounter[- ]?argument\b|\bwhat\s+could\s+go\s+wrong\b/i, weight: 0.6, label: 'presents the bear case' },
  { re: /\b(disclosure|disclaimer)\b.{0,80}\b(position|long|short|own|holdings?)\b/i, weight: 0.5, label: 'discloses positions' },
  { re: /\b(10-?k|10-?q|8-?k|annual\s+report|proxy\s+statement|prospectus)\b/i, weight: 0.6, label: 'cites primary filings' },
  { re: /\b(expense\s+ratio|tracking\s+error|assets\s+under\s+management|net\s+asset\s+value)\b/i, weight: 0.4, label: 'discusses fund mechanics' },
  { re: /\b(discounted\s+cash\s+flow|dcf|free\s+cash\s+flow\s+yield|earnings\s+yield|ev\/ebitda|price[- ]to[- ]book)\b/i, weight: 0.5, label: 'uses explicit valuation methods' },
  { re: /\b(standard\s+deviation|sharpe\s+ratio|volatility|drawdown|correlation|backtest)\b/i, weight: 0.4, label: 'quantifies risk' },
  { re: /\b(past\s+performance|not\s+(investment\s+)?advice|do\s+your\s+own\s+research)\b/i, weight: 0.25, label: 'includes standard caveats' },
  { re: /\b(diversif\w+|asset\s+allocation|rebalanc\w+|time\s+horizon)\b/i, weight: 0.35, label: 'thinks in portfolio terms' },
  { re: /\bsource:|\baccording\s+to\b|\bdata\s+from\b/i, weight: 0.3, label: 'attributes its data' },
];

/**
 * Domain tiers. Not a judgement of any individual author — a prior on how much
 * editorial process typically sits behind the content, which is then updated
 * by what the page actually says.
 */
export const DOMAIN_TIERS = [
  { tier: 0.92, label: 'primary source / regulator', domains: ['sec.gov', 'federalreserve.gov', 'treasury.gov', 'bls.gov', 'bea.gov', 'imf.org', 'worldbank.org', 'ecb.europa.eu', 'bis.org'] },
  { tier: 0.85, label: 'fund or issuer document', domains: ['vanguard.com', 'blackrock.com', 'ishares.com', 'ssga.com', 'schwab.com', 'fidelity.com', 'invesco.com', 'statestreet.com', 'pimco.com', 'dimensional.com'] },
  { tier: 0.8, label: 'academic / research', domains: ['ssrn.com', 'nber.org', 'arxiv.org', 'jstor.org', 'aqr.com', 'papers.ssrn.com', 'scholar.google.com'] },
  { tier: 0.75, label: 'established financial press', domains: ['ft.com', 'wsj.com', 'economist.com', 'bloomberg.com', 'reuters.com', 'barrons.com', 'morningstar.com', 'spglobal.com'] },
  { tier: 0.62, label: 'mainstream financial media', domains: ['cnbc.com', 'marketwatch.com', 'forbes.com', 'businessinsider.com', 'yahoo.com', 'finance.yahoo.com', 'investopedia.com', 'nasdaq.com', 'kiplinger.com'] },
  { tier: 0.5, label: 'analyst platform', domains: ['seekingalpha.com', 'fool.com', 'zacks.com', 'gurufocus.com', 'simplywall.st', 'koyfin.com', 'stockanalysis.com', 'tipranks.com'] },
  { tier: 0.35, label: 'video / social', domains: ['youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'tiktok.com', 'instagram.com', 'facebook.com'] },
  { tier: 0.3, label: 'forum / user-generated', domains: ['reddit.com', 'stocktwits.com', 'discord.com', 'medium.com', 'substack.com', 'quora.com'] },
];

export function domainTier(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  for (const t of DOMAIN_TIERS) {
    if (t.domains.some((d) => host === d || host.endsWith(`.${d}`))) {
      return { tier: t.tier, label: t.label };
    }
  }
  return { tier: 0.45, label: 'unclassified source' };
}
