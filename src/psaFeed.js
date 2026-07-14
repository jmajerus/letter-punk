/**
 * Fetches and normalizes items from a small set of genuine, verified public
 * newsroom feeds (ICRC, WHO) for the client-side awareness banner
 * (public/modules/psaBanner.js). No third-party feed-conversion middleman —
 * this fetches each org's real XML directly and parses just enough of it to
 * pull out a title, link, summary, and date. Deliberately no XML-parsing
 * dependency: both feed shapes are simple and regular enough that a small,
 * targeted extractor is more honest about what it does than pulling in a
 * general-purpose parser for two known shapes.
 *
 * Adding another source later means adding one entry to FEED_SOURCES and,
 * if its shape doesn't match RSS 2.0 or Atom, one more parser function.
 */

const FEED_SOURCES = [
  { id: 'icrc', label: 'ICRC', url: 'https://www.icrcnewsroom.org/rss', format: 'atom' },
  { id: 'who', label: 'WHO', url: 'https://www.who.int/rss-feeds/news-english.xml', format: 'rss2' },
];

const FETCH_TIMEOUT_MS = 6000;
const MAX_ITEMS_PER_SOURCE = 4;
const MAX_SUMMARY_LENGTH = 220;
const CACHE_TTL_SECONDS = 3600;
const CACHE_KEY = 'psa_feed_v1';
const USER_AGENT = 'LetterPunkPSABanner/1.0 (+https://letter-punk.jmajerus.workers.dev)';

function decodeEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // must run last, or earlier replacements re-decode
}

function stripTags(raw) {
  return decodeEntities(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1] : '';
}

function matchAttr(block, tagName, attrName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*\\s${attrName}=["']([^"']*)["'][^>]*\\/?>`, 'i'));
  return match ? match[1] : '';
}

function extractBlocks(xml, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi');
  return xml.match(re) || [];
}

function buildItem({ source, title, link, summary, dateText, id }) {
  const cleanTitle = stripTags(title);
  const cleanLink = stripTags(link);
  if (!cleanTitle || !cleanLink) {
    return null;
  }

  const cleanSummary = stripTags(summary);
  const timestamp = Date.parse(dateText || '');

  return {
    id: stripTags(id) || cleanLink,
    org: source.label,
    orgId: source.id,
    title: cleanTitle,
    link: cleanLink,
    summary: cleanSummary.length > MAX_SUMMARY_LENGTH
      ? `${cleanSummary.slice(0, MAX_SUMMARY_LENGTH - 1).trim()}…`
      : cleanSummary,
    publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
  };
}

function parseAtomEntry(block, source) {
  return buildItem({
    source,
    title: matchTag(block, 'title'),
    link: matchAttr(block, 'link', 'href'),
    summary: matchTag(block, 'summary') || matchTag(block, 'content'),
    dateText: matchTag(block, 'updated') || matchTag(block, 'published'),
    id: matchTag(block, 'id'),
  });
}

function parseRss2Item(block, source) {
  return buildItem({
    source,
    title: matchTag(block, 'title'),
    link: matchTag(block, 'link'),
    summary: matchTag(block, 'description'),
    dateText: matchTag(block, 'pubDate'),
    id: matchTag(block, 'guid'),
  });
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
    return response.ok ? await response.text() : null;
  } catch {
    // Network failure, timeout, or non-XML response -- treat this one
    // source as unavailable rather than failing the whole feed.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSourceItems(source) {
  const xml = await fetchWithTimeout(source.url, FETCH_TIMEOUT_MS);
  if (!xml) {
    return [];
  }

  const blockTag = source.format === 'atom' ? 'entry' : 'item';
  const parser = source.format === 'atom' ? parseAtomEntry : parseRss2Item;

  const items = [];
  for (const block of extractBlocks(xml, blockTag)) {
    const item = parser(block, source);
    if (item) {
      items.push(item);
    }
    if (items.length >= MAX_ITEMS_PER_SOURCE) {
      break;
    }
  }
  return items;
}

// Round-robins across sources (one ICRC, one WHO, one ICRC, ...) rather than
// listing every item from one org before the other, so the client's
// rotation doesn't have to work through a whole org's worth of stories
// before ever reaching the other one.
function interleaveBySource(items) {
  const bySource = FEED_SOURCES.map((source) => items.filter((item) => item.orgId === source.id));
  const maxLength = Math.max(0, ...bySource.map((list) => list.length));
  const interleaved = [];
  for (let index = 0; index < maxLength; index += 1) {
    for (const list of bySource) {
      if (list[index]) {
        interleaved.push(list[index]);
      }
    }
  }
  return interleaved;
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ waitUntil?: (p: Promise<unknown>) => void }} [ctx]
 * @returns {Promise<Array<object>>}
 */
export async function getPsaFeedItems(env, ctx) {
  if (env.PSA_CACHE && typeof env.PSA_CACHE.get === 'function') {
    const cached = await env.PSA_CACHE.get(CACHE_KEY, { type: 'json' }).catch(() => null);
    if (Array.isArray(cached) && cached.length > 0) {
      return cached;
    }
  }

  const results = await Promise.all(FEED_SOURCES.map((source) => fetchSourceItems(source)));
  const interleaved = interleaveBySource(results.flat());

  if (interleaved.length > 0 && env.PSA_CACHE && typeof env.PSA_CACHE.put === 'function') {
    const putPromise = env.PSA_CACHE.put(CACHE_KEY, JSON.stringify(interleaved), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(putPromise);
    }
  }

  return interleaved;
}
