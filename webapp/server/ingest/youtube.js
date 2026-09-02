// YouTube handling. A video URL has no readable body, so we pull the player
// response out of the watch page for title/channel/description, then try the
// timed-text endpoint for a real transcript. Captions are frequently
// unavailable; when they are, we say so instead of pretending we watched it.

import { fetchUrl } from './fetcher.js';
import { decodeEntities } from './html.js';

export function isYouTube(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return ['youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(h);
  } catch {
    return false;
  }
}

export function videoId(url) {
  try {
    const u = new URL(url);
    // Guard the host: without this, any /watch?v= URL anywhere would be treated
    // as a video and sent to youtube.com for a completely unrelated id.
    if (!isYouTube(url)) return null;
    if (u.hostname.replace(/^www\./, '') === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

/** Extracts the embedded ytInitialPlayerResponse JSON object from a watch page. */
function extractPlayerResponse(html) {
  const marker = 'ytInitialPlayerResponse';
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Turns a timedtext XML payload into a plain transcript. */
function transcriptFromXml(xml) {
  const parts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => decodeEntities(decodeEntities(m[1])).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return parts.join(' ');
}

/**
 * Fetches whatever a YouTube URL can actually give us.
 * @returns {{ok, title, channel, description, transcript, transcriptSource, note}}
 */
export async function fetchYouTube(url) {
  const id = videoId(url);
  if (!id) return { ok: false, reason: 'Could not parse a video id from that YouTube URL.' };

  const page = await fetchUrl(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`);
  if (!page.ok) return { ok: false, reason: page.reason };

  const player = extractPlayerResponse(page.body);
  const details = player?.videoDetails ?? {};
  const result = {
    ok: true,
    kind: 'youtube',
    videoId: id,
    title: details.title ?? null,
    channel: details.author ?? null,
    description: details.shortDescription ?? null,
    lengthSeconds: Number(details.lengthSeconds) || null,
    viewCount: Number(details.viewCount) || null,
    transcript: null,
    transcriptSource: null,
    note: null,
  };

  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = tracks.find((t) => /^en/i.test(t.languageCode || '')) ?? tracks[0];
  if (track?.baseUrl) {
    const cap = await fetchUrl(track.baseUrl);
    if (cap.ok) {
      const text = transcriptFromXml(cap.body);
      if (text.length > 200) {
        result.transcript = text;
        result.transcriptSource = track.kind === 'asr' ? 'auto-generated captions' : 'published captions';
      }
    }
  }
  if (!result.transcript) {
    result.note = 'No transcript was retrievable for this video; analysis of it rests on the title and description only.';
  }
  return result;
}
