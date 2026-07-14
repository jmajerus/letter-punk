/**
 * Awareness banner: rotates through real, verified items pulled from
 * ICRC's and WHO's own public newsroom feeds (see src/psaFeed.js). Not an
 * endorsement claim in either direction — each item links straight back to
 * the source organization's own page, labeled as exactly that ("via ICRC"),
 * never presented as a partnership.
 *
 * Selection is hourly-rotating but skips anything the player has already
 * seen (tracked in localStorage) — once every current item has been shown,
 * the banner simply stays hidden rather than repeating one. All DOM text
 * from the feed is set via textContent, never innerHTML, since feed content
 * originates from a third party.
 */
const HOUR_MS = 3_600_000;

function readSeenIds(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function markSeen(storageKey, id) {
  try {
    const seen = readSeenIds(storageKey);
    seen.add(id);
    window.localStorage.setItem(storageKey, JSON.stringify([...seen]));
  } catch {
    // Ignore storage failures -- worst case an item repeats a bit sooner.
  }
}

function formatDate(isoString) {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function createPsaBanner({
  containerElement,
  isEnabled,
  storageKey = 'letter-punk.psa-seen',
  fetchImpl = fetch,
}) {
  let items = [];
  let loaded = false;

  function pickItem() {
    if (items.length === 0) {
      return null;
    }

    const seen = readSeenIds(storageKey);
    const hourIndex = Math.floor(Date.now() / HOUR_MS);
    for (let offset = 0; offset < items.length; offset += 1) {
      const candidate = items[(hourIndex + offset) % items.length];
      if (!seen.has(candidate.id)) {
        return candidate;
      }
    }

    return null; // everything currently offered has already been seen
  }

  function clear() {
    if (!containerElement) {
      return;
    }
    containerElement.innerHTML = '';
    containerElement.hidden = true;
  }

  function render(item) {
    if (!containerElement) {
      return;
    }

    if (!item) {
      clear();
      return;
    }

    containerElement.innerHTML = '';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'psa-banner-eyebrow';
    eyebrow.textContent = 'Global Awareness';

    const meta = document.createElement('p');
    meta.className = 'psa-banner-meta';
    const dateText = formatDate(item.publishedAt);
    meta.textContent = dateText ? `via ${item.org} · ${dateText}` : `via ${item.org}`;

    const titleLink = document.createElement('a');
    titleLink.className = 'psa-banner-title';
    titleLink.href = item.link;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = item.title;

    const summary = document.createElement('p');
    summary.className = 'psa-banner-summary';
    summary.textContent = item.summary;

    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'psa-banner-dismiss';
    dismissButton.setAttribute('aria-label', 'Dismiss this awareness message');
    dismissButton.textContent = '×';
    dismissButton.addEventListener('click', () => {
      markSeen(storageKey, item.id);
      clear();
    });

    const textGroup = document.createElement('div');
    textGroup.className = 'psa-banner-text';
    textGroup.append(eyebrow, meta, titleLink, summary);

    containerElement.append(textGroup, dismissButton);
    containerElement.hidden = false;
  }

  async function init() {
    if (!containerElement) {
      return;
    }

    if (typeof isEnabled === 'function' && !isEnabled()) {
      clear();
      return;
    }

    if (!loaded) {
      try {
        const response = await fetchImpl('/api/psa-feed');
        const data = response.ok ? await response.json() : [];
        items = Array.isArray(data) ? data : [];
      } catch {
        items = [];
      }
      loaded = true;
    }

    const item = pickItem();
    render(item);
    if (item) {
      markSeen(storageKey, item.id);
    }
  }

  return { init };
}
