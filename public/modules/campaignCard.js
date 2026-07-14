/**
 * Small, static awareness card shown by default in the lower-left of the
 * pipe-artwork panel — a single targeted campaign link, not a stream of
 * news. Deliberately no server/KV involved: this is a tiny, hand-curated,
 * hand-verified list bundled directly in the client, unlike the optional
 * live-feed banner (psaBanner.js).
 *
 * No organization logos or official imagery — each entry links straight to
 * that org's own real page, but the card itself is drawn in Letter Punk's
 * own visual language, so there's no brand-usage question to get wrong.
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
 * Each entry is chosen to be both evergreen (not tied to a single dated
 * event) and currently salient, rather than a generic org-homepage link --
 * e.g. the rules of war apply timelessly, but are especially worth surfacing
 * given current world events; online misinformation is a standing problem,
 * not a one-off news item. One entry links to an educational *game* rather
 * than an org campaign page, which fits naturally alongside a word game.
 *
 * Verified directly (not guessed) before adding -- and this cuts both ways:
 * a same-source candidate, "Bad News" (inoculation.science/inoculation-games
 * /bad-news/), was checked and deliberately left out because its embedded
 * game domain (getbadnews.com) now serves a mismatched TLS cert and a
 * generic "Unknown Domain" hosting placeholder instead of the actual game --
 * the listing page itself still loads, so a URL-status check alone
 * wouldn't have caught this; only actually loading the embedded game did.
 *   - ICRC's own official "Respect the Rules of War" education campaign
 *   - WHO's own official page on combating health misinformation online
 *   - "Bad Vaxx" and "Harmony Square," free games from Cambridge
 *     University's Social Decision-Making Lab (via DROG/Bad News) that
 *     build resistance to manipulation -- vaccine misinformation and
 *     political disinformation respectively -- by having players try the
 *     tactics themselves
 */
const CAMPAIGNS = [
  {
    id: 'icrc-rules-of-war',
    eyebrow: 'Supporting: ICRC',
    headline: 'Even in war, there are rules — what they are and why',
    cta: 'Explore the Rules of War',
    link: 'https://www.icrc.org/en/rulesofwar',
  },
  {
    id: 'who-misinformation',
    eyebrow: 'Supporting: WHO',
    headline: 'False health claims spread faster online than the truth',
    cta: 'See how WHO is fighting back',
    link: 'https://www.who.int/teams/digital-health-and-innovation/digital-channels/combatting-misinformation-online',
  },
  {
    id: 'inoculation-bad-vaxx',
    eyebrow: 'Play: Cambridge',
    headline: 'A short game that builds resistance to vaccine myths',
    cta: 'Try Bad Vaxx',
    link: 'https://inoculation.science/inoculation-games/bad-vaxx/',
  },
  {
    id: 'inoculation-harmony-square',
    eyebrow: 'Play: Cambridge',
    headline: 'A short game that builds resistance to political spin',
    cta: 'Try Harmony Square',
    link: 'https://inoculation.science/inoculation-games/harmony-square/',
  },
];

const DAY_MS = 86_400_000;

export function createCampaignCard({ containerElement }) {
  let dismissedThisSession = false;

  function pickCampaign() {
    if (CAMPAIGNS.length === 0) {
      return null;
    }
    const dayIndex = Math.floor(Date.now() / DAY_MS);
    return CAMPAIGNS[dayIndex % CAMPAIGNS.length];
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
