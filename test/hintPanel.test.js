import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHintPanel } from '../public/modules/hintPanel.js';

function fakeButton() {
  const listeners = [];
  return {
    hidden: false,
    addEventListener(event, fn) {
      if (event === 'click') {
        listeners.push(fn);
      }
    },
    click() {
      listeners.forEach((fn) => fn());
    },
  };
}

function fakeText() {
  return { hidden: true, textContent: '' };
}

function createPanel(words) {
  const hintShapeButton = fakeButton();
  const hintShapeText = fakeText();
  const hintLettersButton = fakeButton();
  const hintLettersText = fakeText();
  const hintWordsButton = fakeButton();
  const hintWordsText = fakeText();

  const panel = createHintPanel({
    getActiveCanonicalWords: () => words,
    hintShapeButton,
    hintShapeText,
    hintLettersButton,
    hintLettersText,
    hintWordsButton,
    hintWordsText,
  });
  panel.init();

  return {
    panel, hintShapeButton, hintShapeText, hintLettersButton, hintLettersText, hintWordsButton, hintWordsText,
  };
}

test('clicking the shape tier reveals word count and lengths, then hides its own button', () => {
  const { hintShapeButton, hintShapeText } = createPanel(['HOLDINGS', 'SABER']);

  hintShapeButton.click();

  assert.equal(hintShapeText.hidden, false);
  assert.equal(hintShapeText.textContent, 'Solves in 2 words: 8, then 5 letters.');
  assert.equal(hintShapeButton.hidden, true, 'the button should hide once its own tier is revealed');
});

test('a single-word canonical solution uses singular "word" in the shape tier', () => {
  const { hintShapeButton, hintShapeText } = createPanel(['BEEKEEPER']);

  hintShapeButton.click();

  assert.equal(hintShapeText.textContent, 'Solves in 1 word: 9 letters.');
});

test('clicking the letters tier reveals start/end letters and length for each word', () => {
  const { hintLettersButton, hintLettersText } = createPanel(['HOLDINGS', 'SABER']);

  hintLettersButton.click();

  assert.equal(
    hintLettersText.textContent,
    'Word 1: starts with H, ends with S (8 letters). Word 2: starts with S, ends with R (5 letters).',
  );
});

test('clicking the words tier reveals the full canonical solution', () => {
  const { hintWordsButton, hintWordsText } = createPanel(['HOLDINGS', 'SABER']);

  hintWordsButton.click();

  assert.equal(hintWordsText.textContent, 'HOLDINGS, SABER');
});

test('tiers are independent -- clicking one does not reveal or hide the others', () => {
  const {
    hintShapeButton, hintShapeText, hintLettersText, hintWordsText,
  } = createPanel(['CAT', 'TOAD']);

  hintShapeButton.click();

  assert.equal(hintShapeText.hidden, false);
  assert.equal(hintLettersText.hidden, true);
  assert.equal(hintWordsText.hidden, true);
});

test('clicking a tier with no known canonical solution does nothing, and leaves the button available', () => {
  const { hintShapeButton, hintShapeText } = createPanel([]);

  hintShapeButton.click();

  assert.equal(hintShapeText.hidden, true);
  assert.equal(hintShapeText.textContent, '');
  assert.equal(hintShapeButton.hidden, false, 'a solution may become known later (e.g. a fresh board applied), so this must not lock shut');
});

test('resetHints re-hides every tier, clears its text, and re-shows every button', () => {
  const {
    panel, hintShapeButton, hintShapeText, hintLettersButton, hintWordsButton, hintWordsText,
  } = createPanel(['CAT', 'TOAD']);
  hintShapeButton.click();
  hintWordsButton.click();
  assert.equal(hintShapeText.hidden, false);
  assert.equal(hintWordsText.hidden, false);

  panel.resetHints();

  assert.equal(hintShapeButton.hidden, false);
  assert.equal(hintLettersButton.hidden, false);
  assert.equal(hintWordsButton.hidden, false);
  assert.equal(hintShapeText.hidden, true);
  assert.equal(hintShapeText.textContent, '');
  assert.equal(hintWordsText.hidden, true);
  assert.equal(hintWordsText.textContent, '');
});
