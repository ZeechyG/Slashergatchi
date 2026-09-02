// Minimal readability pass: HTML in, article-ish plain text out. A full DOM
// parser buys very little here — what matters is dropping navigation and
// script noise so the entity extractor is not reading menu labels.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…',
  trade: '™', reg: '®', copy: '©', deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢',
};

export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code) {
  try {
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

/** Pulls the fields worth knowing about a page before reading its body. */
export function extractMetadata(html) {
  const meta = {};
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title) meta.title = decodeEntities(title[1]).replace(/\s+/g, ' ').trim();

  const grab = (attr, key) => {
    const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*>`, 'i');
    const tag = re.exec(html);
    if (!tag) return null;
    const content = /content=["']([\s\S]*?)["']/i.exec(tag[0]);
    return content ? decodeEntities(content[1]).replace(/\s+/g, ' ').trim() : null;
  };

  meta.description = grab('name', 'description') || grab('property', 'og:description');
  meta.ogTitle = grab('property', 'og:title');
  meta.siteName = grab('property', 'og:site_name');
  meta.author = grab('name', 'author') || grab('property', 'article:author');
  meta.published = grab('property', 'article:published_time') ||
    grab('name', 'publish-date') || grab('itemprop', 'datePublished');

  // JSON-LD often carries a clean date and author when the meta tags do not.
  const ld = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (ld) {
    try {
      const parsed = JSON.parse(ld[1].trim());
      const node = Array.isArray(parsed) ? parsed[0] : parsed;
      meta.published ||= node?.datePublished;
      meta.author ||= typeof node?.author === 'string' ? node.author : node?.author?.name;
      meta.ogTitle ||= node?.headline;
    } catch { /* malformed JSON-LD is common; ignore it */ }
  }
  return meta;
}

/**
 * Strips a page down to readable text. Prefers <article>/<main> when present,
 * because that is where the argument lives and the sidebar is where the ads do.
 */
export function htmlToText(html) {
  let doc = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|iframe|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');

  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(doc) ||
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(doc);
  if (article && article[1].length > 400) doc = article[1];

  return decodeEntities(
    doc
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|section)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

/** Parses a CSV/TSV payload into rows, handling quoted fields. */
export function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
