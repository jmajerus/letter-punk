const SYSTEM_REDUCED_MOTION_QUERY = window.matchMedia('(prefers-reduced-motion: reduce)');

const REDUCED_MOTION_STORAGE_KEY = 'letter-punk.reduced-motion';
const PROVENANCE_BADGES_STORAGE_KEY = 'letter-punk.provenance-badges';
const FREE_CHAIN_STORAGE_KEY = 'letter-punk.free-chain';
const SHARE_INCLUDE_LINK_STORAGE_KEY = 'letter-punk.share-include-link';

function readPreference(storageKey) {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === 'on' || value === 'off') {
      return value;
    }
  } catch {
    // Ignore storage reads when unavailable.
  }

  return null;
}

function setPreference(storageKey, enabled) {
  const value = enabled ? 'on' : 'off';
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Ignore storage writes when unavailable.
  }
  return value;
}

// Owns the four persisted Settings toggles (reduced motion, dictionary
// provenance badges, Free Chain mode, share-include-link) plus Free Chain's
// session-only override -- everything that reads/writes
// window.localStorage and keeps its own <input type="checkbox"> in sync.
// setFreeChainModeOnEngine is a callback rather than a gameEngine reference
// so this module can be created before gameEngine exists (same pattern
// boardRenderer.js's onTileSelect uses) -- app.js's own createGameEngine
// call needs isFreeChainModeEnabled() for its initial value, which would be
// circular if this module had to wait for gameEngine first.
export function createSettings({
  reducedMotionToggle,
  provenanceBadgesToggle,
  freeChainToggle,
  shareIncludeLinkToggle,
  setFreeChainModeOnEngine,
}) {
  let reducedMotionPreference = readPreference(REDUCED_MOTION_STORAGE_KEY);
  let provenanceBadgesPreference = readPreference(PROVENANCE_BADGES_STORAGE_KEY);
  let freeChainPreference = readPreference(FREE_CHAIN_STORAGE_KEY);
  // Off by default so a shared result stays clean text with no link, the
  // way a Wordle grid never carries a link either -- see app.js's
  // shareResult.
  let shareIncludeLinkPreference = readPreference(SHARE_INCLUDE_LINK_STORAGE_KEY);
  // Session-only, in-memory: forces Free Chain mode on for the puzzle
  // currently loaded, without touching freeChainPreference (the persisted
  // Settings default). Only a shared link whose progress words don't
  // actually chain sets this — see puzzleReplay.js's hydrateSharedPuzzle —
  // and only the three board-application paths (catalog navigation, manual
  // Set Board, a new shared link) clear it. Toggling the Settings checkbox
  // itself is the one and only way to make a change stick beyond the
  // current puzzle.
  let freeChainSessionOverride = null;

  function isProvenanceBadgesEnabled() {
    return provenanceBadgesPreference === 'on';
  }

  function isShareIncludeLinkEnabled() {
    return shareIncludeLinkPreference === 'on';
  }

  function isReducedMotionEnabled() {
    if (reducedMotionPreference === 'on') {
      return true;
    }

    if (reducedMotionPreference === 'off') {
      return false;
    }

    return SYSTEM_REDUCED_MOTION_QUERY.matches;
  }

  // Whether reduced motion is currently following the OS-level media query
  // rather than an explicit Settings choice -- only relevant to the change
  // listener registered via onSystemReducedMotionChange below: an explicit
  // off/on choice should never be silently overridden just because the OS
  // setting changed underneath it.
  function isReducedMotionFollowingSystem() {
    return reducedMotionPreference === null;
  }

  function syncMotionPreferenceToUi() {
    const reducedMotionEnabled = isReducedMotionEnabled();
    document.body.classList.toggle('reduce-motion', reducedMotionEnabled);
    if (reducedMotionToggle) {
      reducedMotionToggle.checked = reducedMotionEnabled;
    }
  }

  function syncProvenanceBadgesPreferenceToUi() {
    if (provenanceBadgesToggle) {
      provenanceBadgesToggle.checked = isProvenanceBadgesEnabled();
    }
  }

  function syncShareIncludeLinkPreferenceToUi() {
    if (shareIncludeLinkToggle) {
      shareIncludeLinkToggle.checked = isShareIncludeLinkEnabled();
    }
  }

  // The session override (if any) always wins over the persisted default —
  // it exists specifically to reflect a shared link's actual played state,
  // which the persisted default can't know about.
  function isFreeChainModeEnabled() {
    return freeChainSessionOverride !== null ? freeChainSessionOverride : freeChainPreference === 'on';
  }

  function syncFreeChainPreferenceToUi() {
    if (freeChainToggle) {
      freeChainToggle.checked = isFreeChainModeEnabled();
    }
  }

  function applyFreeChainModeToEngine() {
    setFreeChainModeOnEngine(isFreeChainModeEnabled());
    syncFreeChainPreferenceToUi();
  }

  function setReducedMotionPreference(enabled) {
    reducedMotionPreference = setPreference(REDUCED_MOTION_STORAGE_KEY, enabled);
    syncMotionPreferenceToUi();
  }

  function setProvenanceBadgesPreference(enabled) {
    provenanceBadgesPreference = setPreference(PROVENANCE_BADGES_STORAGE_KEY, enabled);
    syncProvenanceBadgesPreferenceToUi();
  }

  function setShareIncludeLinkPreference(enabled) {
    shareIncludeLinkPreference = setPreference(SHARE_INCLUDE_LINK_STORAGE_KEY, enabled);
    syncShareIncludeLinkPreferenceToUi();
  }

  // The only path that writes FREE_CHAIN_STORAGE_KEY — called solely from
  // the Settings checkbox handler. An explicit Settings change always wins
  // over, and clears, any temporary session override a shared link may
  // have set, since the player just told us directly what they want going
  // forward.
  function setFreeChainPreference(enabled) {
    freeChainPreference = setPreference(FREE_CHAIN_STORAGE_KEY, enabled);
    freeChainSessionOverride = null;
    applyFreeChainModeToEngine();
  }

  function setFreeChainSessionOverride(enabled) {
    freeChainSessionOverride = enabled;
    applyFreeChainModeToEngine();
  }

  // Scopes a session override to the puzzle that produced it: called at the
  // start of every path that loads a genuinely different board (catalog
  // navigation, manual Set Board, a new shared link) so a Free Chain
  // override from a previous shared link never leaks into an unrelated
  // puzzle.
  function clearFreeChainSessionOverride() {
    if (freeChainSessionOverride === null) {
      return;
    }

    freeChainSessionOverride = null;
    applyFreeChainModeToEngine();
  }

  // Syncs all four toggles at once -- the one thing openSettingsModal
  // actually needs, since a player can leave the modal open across a
  // shared-link load or catalog navigation that changed a preference out
  // from under it.
  function syncAllToUi() {
    syncMotionPreferenceToUi();
    syncProvenanceBadgesPreferenceToUi();
    syncFreeChainPreferenceToUi();
    syncShareIncludeLinkPreferenceToUi();
  }

  // Wraps the OS-level reduced-motion media query's own change event,
  // absorbing both the feature-detection guard (older browsers lack
  // addEventListener on a MediaQueryList) and the "only matters when
  // following the system, not an explicit choice" check, so app.js's own
  // wireEvents doesn't need to know either of those details.
  function onSystemReducedMotionChange(callback) {
    if (typeof SYSTEM_REDUCED_MOTION_QUERY.addEventListener !== 'function') {
      return;
    }

    SYSTEM_REDUCED_MOTION_QUERY.addEventListener('change', () => {
      if (isReducedMotionFollowingSystem()) {
        callback();
      }
    });
  }

  return {
    isReducedMotionEnabled,
    isProvenanceBadgesEnabled,
    isShareIncludeLinkEnabled,
    isFreeChainModeEnabled,
    setReducedMotionPreference,
    setProvenanceBadgesPreference,
    setShareIncludeLinkPreference,
    setFreeChainPreference,
    setFreeChainSessionOverride,
    clearFreeChainSessionOverride,
    syncMotionPreferenceToUi,
    syncProvenanceBadgesPreferenceToUi,
    syncAllToUi,
    onSystemReducedMotionChange,
  };
}
