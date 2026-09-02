// Fetches the user's URLs server-side. Doing this in the browser is impossible
// (CORS) and doing it naively on a server is dangerous: a URL box that will
// fetch anything is an SSRF hole pointed at whatever else lives on the host.
// Everything here is about fetching only what a user could have fetched
// themselves from the public internet.

import dns from 'node:dns/promises';
import net from 'node:net';

export const LIMITS = {
  timeoutMs: 15000,
  maxBytes: 3_000_000,
  maxRedirects: 4,
  userAgent: 'Mozilla/5.0 (compatible; CapitalAllocator/1.0; +research-tool)',
};

/** Blocks loopback, link-local, private and reserved address space. */
export function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;                 // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;        // carrier-grade NAT
    if (a === 192 && b === 0) return true;
    if (a >= 224) return true;                                // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    if (v.startsWith('::ffff:')) return isBlockedAddress(v.slice(7));
    return false;
  }
  return true;
}

/**
 * Validates a URL and resolves its host, rejecting anything that points at
 * private infrastructure. Returns {ok, url} or {ok:false, reason}.
 */
export async function vetUrl(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'Not a valid URL.' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, reason: `Unsupported scheme "${url.protocol}" — only http and https are fetched.` };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    return { ok: false, reason: 'Refusing to fetch internal hostnames.' };
  }
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) return { ok: false, reason: 'Refusing to fetch private or reserved IP space.' };
    return { ok: true, url };
  }
  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) return { ok: false, reason: 'Host did not resolve.' };
    if (records.some((r) => isBlockedAddress(r.address))) {
      return { ok: false, reason: 'Host resolves to private or reserved IP space.' };
    }
  } catch (err) {
    return { ok: false, reason: `DNS lookup failed: ${err.code || err.message}` };
  }
  return { ok: true, url };
}

/**
 * Fetches a URL with a byte cap, a timeout and manual redirect handling so
 * every hop is re-vetted (a public URL can redirect to 169.254.169.254).
 */
export async function fetchUrl(raw, { timeoutMs = LIMITS.timeoutMs, maxBytes = LIMITS.maxBytes } = {}) {
  let current = raw;
  const chain = [];

  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    const vetted = await vetUrl(current);
    if (!vetted.ok) return { ok: false, url: current, reason: vetted.reason, chain };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(vetted.url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': LIMITS.userAgent,
          Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const reason = err.name === 'AbortError'
        ? `Timed out after ${timeoutMs / 1000}s`
        : `Network error: ${err.cause?.code || err.message}`;
      return { ok: false, url: current, reason, chain };
    }
    clearTimeout(timer);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, url: current, reason: `HTTP ${res.status} with no redirect target`, chain };
      chain.push(current);
      current = new URL(loc, vetted.url).toString();
      continue;
    }

    if (!res.ok) {
      return { ok: false, url: current, reason: `HTTP ${res.status} ${res.statusText}`, status: res.status, chain };
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) {
      return { ok: false, url: current, reason: `Response is ${(declared / 1e6).toFixed(1)}MB, over the ${(maxBytes / 1e6).toFixed(0)}MB limit`, chain };
    }

    const body = await readCapped(res, maxBytes);
    return {
      ok: true,
      url: current,
      finalUrl: res.url || current,
      status: res.status,
      contentType,
      body: body.text,
      truncated: body.truncated,
      bytes: body.bytes,
      chain,
    };
  }
  return { ok: false, url: current, reason: `Exceeded ${LIMITS.maxRedirects} redirects`, chain };
}

/** Streams the body, stopping at the byte cap rather than buffering blindly. */
async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes, bytes: text.length };
  }
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      chunks.push(value.slice(0, value.length - (total - maxBytes)));
      truncated = true;
      try { await reader.cancel(); } catch { /* already closed */ }
      break;
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buf.toString('utf8'), truncated, bytes: buf.length };
}
