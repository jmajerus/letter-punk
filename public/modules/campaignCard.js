/**
 * Small, static awareness card shown by default in the lower-left of the
 * pipe-artwork panel — a single targeted campaign link, not a stream of
 * news. Deliberately no server/KV involved: this is a tiny, hand-curated,
 * hand-verified list bundled directly in the client, unlike the optional
 * live-feed banner (psaBanner.js). The entries themselves live in
 * campaignCardData.js -- kept separate so adding, editing, or retiring one
 * is a one-file edit that never touches this rendering/rotation logic.
 *
 * Deliberately educational, not fundraising — the point is to put real
 * knowledge in front of people who might not go looking for it themselves
 * (including players who enjoy war-themed games but may never have
 * encountered the actual laws of armed conflict), not to solicit donations.
 * For that same reason there's no Settings toggle to turn this off for
 * good — only the × dismisses it, and only for the current visit. A
 * permanent opt-out would let exactly the players this is aimed at back out
 * before it ever reached them.
 *
 * Rotation length is derived from CAMPAIGNS.length rather than a fixed
 * per-entry duration, so the time to see every entry once stays roughly
 * constant (TARGET_FULL_ROTATION_DAYS) as entries are added, instead of
 * the full cycle just quietly getting longer every time this list grows.
 */
import { CAMPAIGNS } from './campaignCardData.js';

const DAY_MS = 86_400_000;
// Roughly how long a full cycle through every entry should take, holding
// this constant (rather than a fixed per-entry duration) as the reason the
// per-entry time shortens automatically as CAMPAIGNS grows. 5 days matches
// the original ~1-day-per-entry cadence at the list's current size (5
// entries); adding a 6th later shortens each entry's turn to ~20 hours
// instead of stretching the full cycle out to 6 days.
const TARGET_FULL_ROTATION_DAYS = 5;

export function createCampaignCard({ containerElement }) {
  let dismissedThisSession = false;

  function pickCampaign() {
    if (CAMPAIGNS.length === 0) {
      return null;
    }
    const rotationIntervalMs = (TARGET_FULL_ROTATION_DAYS * DAY_MS) / CAMPAIGNS.length;
    const rotationIndex = Math.floor(Date.now() / rotationIntervalMs);
    return CAMPAIGNS[rotationIndex % CAMPAIGNS.length];
  }

  function render() {
    if (!containerElement) {
      return;
    }

    const campaign = dismissedThisSession ? null : pickCampaign();

    if (!campaign) {
      containerElement.hidden = true;
      containerElement.removeAttribute('href');
      containerElement.innerHTML = '';
      return;
    }

    containerElement.innerHTML = '';
    containerElement.href = campaign.link;

    const eyebrow = document.createElement('span');
    eyebrow.className = 'campaign-card-eyebrow';
    eyebrow.textContent = campaign.eyebrow;

    const headline = document.createElement('span');
    headline.className = 'campaign-card-headline';
    headline.textContent = campaign.headline;

    const cta = document.createElement('span');
    cta.className = 'campaign-card-cta';
    cta.textContent = `${campaign.cta} →`;

    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'campaign-card-dismiss';
    dismissButton.setAttribute('aria-label', 'Dismiss this campaign card');
    dismissButton.textContent = '×';
    dismissButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dismissedThisSession = true;
      render();
    });

    containerElement.append(eyebrow, headline, cta, dismissButton);
    containerElement.hidden = false;
  }

  function init() {
    render();
  }

  return { init };
}
