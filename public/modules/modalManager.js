// Owns open/close/focus for the four modals (Help, Yesterday's Puzzle,
// Settings, Set Board) plus the two cross-modal helpers that don't belong
// to any one of them: getActiveModal (which one, if any, is currently
// open) and trapFocusInModal (keeps Tab cycling inside whichever modal is
// open, rather than escaping to the page behind it).
//
// getYesterdayPuzzleData/loadPlayerSolutions/syncSettingsToUi/
// prepareBoardModal are callbacks rather than direct references to
// puzzleFetcher/the /api/solutions fetch/settings/the Set Board
// input-filling helpers, since those are each one specific thing this
// module needs from a neighboring concern, not a reason to depend on the
// whole of it.
export function createModalManager({
  helpModal,
  closeHelpButton,
  helpButton,
  yesterdayModal,
  closeYesterdayButton,
  yesterdayButton,
  yesterdayPuzzleDateElement,
  yesterdayPuzzleWordsElement,
  loadPlayerSolutions,
  settingsModal,
  settingsButton,
  provenanceBadgesToggle,
  boardModal,
  boardTopInput,
  getYesterdayPuzzleData,
  syncSettingsToUi,
  prepareBoardModal,
}) {
  function openHelpModal() {
    if (!helpModal) {
      return;
    }

    helpModal.hidden = false;
    closeHelpButton?.focus();
  }

  function closeHelpModal() {
    if (!helpModal) {
      return;
    }

    helpModal.hidden = true;
    helpButton?.focus();
  }

  function openYesterdayModal() {
    const yesterdayData = getYesterdayPuzzleData();
    if (!yesterdayModal || !yesterdayData) {
      return;
    }

    if (yesterdayPuzzleDateElement) {
      yesterdayPuzzleDateElement.textContent = yesterdayData.id
        ? `Date: ${yesterdayData.id}`
        : 'Date: Yesterday';
    }

    if (yesterdayPuzzleWordsElement) {
      yesterdayPuzzleWordsElement.textContent = yesterdayData.words.join(' -> ');
    }

    // Fire-and-forget: fills in the "Player solutions" section once the
    // fetch resolves, but never delays showing the canonical solution above.
    loadPlayerSolutions?.(yesterdayData.id);

    yesterdayModal.hidden = false;
    closeYesterdayButton?.focus();
  }

  function closeYesterdayModal() {
    if (!yesterdayModal) {
      return;
    }

    yesterdayModal.hidden = true;
    yesterdayButton?.focus();
  }

  function openSettingsModal() {
    if (!settingsModal) {
      return;
    }

    syncSettingsToUi();
    settingsModal.hidden = false;
    provenanceBadgesToggle?.focus();
  }

  function closeSettingsModal() {
    if (!settingsModal) {
      return;
    }

    settingsModal.hidden = true;
    settingsButton?.focus();
  }

  function openBoardModal() {
    if (!boardModal) {
      return;
    }

    prepareBoardModal();
    boardModal.hidden = false;
    boardTopInput?.focus();
  }

  function closeBoardModal() {
    if (!boardModal) {
      return;
    }

    boardModal.hidden = true;
    // setBoardButton now lives inside the Settings modal (see its click
    // listener in app.js's wireEvents), which is always closed by the time
    // this runs -- focusing it directly would land focus on an element
    // inside a hidden container. The Settings button is the closest stable
    // return point now.
    settingsButton?.focus();
  }

  function getActiveModal() {
    if (boardModal && !boardModal.hidden) {
      return boardModal;
    }

    if (settingsModal && !settingsModal.hidden) {
      return settingsModal;
    }

    if (yesterdayModal && !yesterdayModal.hidden) {
      return yesterdayModal;
    }

    if (helpModal && !helpModal.hidden) {
      return helpModal;
    }

    return null;
  }

  // Closes whatever modal is currently open, if any -- used when the
  // arcade attract loop reclaims the screen (see arcadeMode.js). A modal
  // left open over the loop would both visually block the "this station is
  // free" signal the loop exists to send, and stay fully interactive
  // underneath it, since arcade mode's pointer-events lockout only covers
  // the board and its own controls, not modals.
  function closeActiveModalIfAny() {
    const activeModal = getActiveModal();
    if (activeModal === boardModal) {
      closeBoardModal();
    } else if (activeModal === settingsModal) {
      closeSettingsModal();
    } else if (activeModal === yesterdayModal) {
      closeYesterdayModal();
    } else if (activeModal === helpModal) {
      closeHelpModal();
    }
  }

  function trapFocusInModal(modal, event) {
    if (!modal || event.key !== 'Tab') {
      return;
    }

    const focusable = modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return {
    openHelpModal,
    closeHelpModal,
    openYesterdayModal,
    closeYesterdayModal,
    openSettingsModal,
    closeSettingsModal,
    openBoardModal,
    closeBoardModal,
    getActiveModal,
    closeActiveModalIfAny,
    trapFocusInModal,
  };
}
