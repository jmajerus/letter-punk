/**
 * Hand-curated, hand-verified entries for the awareness card (see
 * campaignCard.js) -- kept in its own file so adding, editing, or retiring
 * an entry never requires touching the card's rendering/rotation logic.
 *
 * No organization logos or official imagery -- each entry links straight to
 * that org's own real page, but the card itself is drawn in Letter Punk's
 * own visual language, so there's no brand-usage question to get wrong.
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
 *   - Poynter's own official MediaWise AI literacy hub
 *   - CCDH's own official "Spot the Fake" AI-generated-image literacy tool.
 *     counterhate.com sits behind Cloudflare bot protection that returns a
 *     403 to both an automated fetch and a direct curl check, so -- unlike
 *     every other entry above -- this one couldn't be verified by actually
 *     loading it from here; confirmed working directly in a real browser
 *     by the requester instead.
 */
export const CAMPAIGNS = [
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
  {
    id: 'poynter-ai-literacy',
    eyebrow: 'Supporting: Poynter',
    headline: "Navigating AI thoughtfully isn't just for experts",
    cta: 'Explore AI literacy resources',
    link: 'https://www.poynter.org/mediawise/ailiteracy/',
  },
  {
    id: 'ccdh-spot-the-fake',
    eyebrow: 'Play: CCDH',
    headline: 'Can you spot an AI-generated fake image from a real one?',
    cta: 'Try Spot the Fake',
    link: 'https://counterhate.com/spot-the-fake/',
  },
];
