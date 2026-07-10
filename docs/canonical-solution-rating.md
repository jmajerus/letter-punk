# Canonical Solution Rating: Designing a Score That Doesn't Fight Your Own Mechanic

This document describes how Letter Punk rates a completed solve against a "canonical" reference solution, and why the design deliberately avoids computing the objectively best possible answer.

The short version: **"canonical" means "the solution we picked," not "the best solution that exists."** Once that's the definition, a much simpler and more game-appropriate scoring system falls out — one that rewards two different kinds of player skill instead of pushing everyone toward the same narrow answer.

## The Starting Point

Letter Punk already had a `getCanonicalCharacterCount` hook (`public/modules/gameLogic.js`) that compares a player's total character count against a reference solution's, and reports whether the player beat or matched it. It worked for daily puzzles, where a human author picks the reference words. The open question was: what should happen for boards that don't have an author-picked reference — a custom board generated on the fly from a single seed word?

The obvious-sounding answer — "compute the best possible solution and use that" — turned out to be the wrong target entirely.

## The Trap: Minimizing Characters Fights the Game's Own Identity

Letter Punk's whole pitch (see the README's "Why Letter Punk Exists") is that double letters are first-class, not excluded the way strict Letter Boxed excludes them. That matters here because of a piece of arithmetic: for a two-word chained solution covering a 12-letter board, the theoretical *minimum* character count is 13 (12 unique letters, plus one forced repeat where the second word's first letter equals the first word's last letter). Every letter reused beyond that mandatory hinge point — i.e. every double-letter tap — only ever adds to the count, never helps it.

That means a search that truly minimizes character count would first exhaust every double-letter-free word pair before ever considering one with a repeat. The "best" answer, by that metric, is specifically the answer that avoids the mechanic the game is built to celebrate. Optimizing for it would have been actively hostile to the game's own design, not neutral.

## The Reframe

The fix wasn't a smarter search — it was rejecting the premise. "Canonical" doesn't have to mean "provably optimal." In every other case in the codebase (a daily puzzle's author-picked words, a custom board's seed-derived words), "canonical" already just means "the solution we happened to pick." Nothing about the word implies effort or optimality. Once that's accepted, there's no obligation to search exhaustively for anything — we just need to pick *a* reasonable reference, honestly, and not oversell what it is.

## Symmetric Scoring Instead of One Winning Direction

The original messaging (`gameLogic.js`) only had two branches: the player beat the canonical count, or matched it. A longer solve got no acknowledgment at all — silence, as if it wasn't worth mentioning. That silence was itself a value judgment: it implicitly treated "shorter" as the only praiseworthy outcome, the same bias that made exhaustive minimization a bad idea in the first place.

The fix was to add a third branch that treats a longer solve as its own kind of accomplishment, not a lesser one:

```js
// public/modules/gameLogic.js
if (playerCharacterCount < canonicalCharacterCount) {
  // "Incredible: you beat the canonical N-character solution!"
} else if (playerCharacterCount === canonicalCharacterCount) {
  // "Nice work: you matched the canonical character count!"
} else if (playerCharacterCount > canonicalCharacterCount) {
  // "Ambitious: that's longer than the canonical N-character solution —
  //  nice work weaving in extra letters!"
}
```

Efficiency (fewest characters) and elaborateness (most creative reuse of the board) are framed as two different, equally valid skills — like a golf par versus a trick-shot leaderboard. Neither direction is "more correct." This applies to every puzzle source, not just computed boards, so a daily-puzzle player who finds a longer path now gets a genuine compliment instead of nothing.

## Picking a Reference Without an Exhaustive Search

For custom boards built from a single seed word, Letter Punk still needs *some* reference word pair. The approach: reuse the dictionary search that already exists for finding a companion word (`dictionaryValidator.findCompanionWord`), sort its full candidate list shortest-to-longest, and start from the **middle of the pack** — a typically-sized companion, deliberately not the shortest or longest extreme.

The one wrinkle: a board's 4-sides-of-3 letter layout isn't computed until *after* a companion is chosen, and not every valid word pair can actually be laid out on a real board (`generateBoardFromSolutionWords` can fail for a given pair). So the median pick isn't final until it's been verified against a real layout attempt. `pickBalancedCompanion` (`public/app.js`) walks outward from the median index, trying each candidate against the actual board-layout solver, and stops at the first one that produces a valid board — capped at a fixed number of attempts so the search stays bounded no matter how large the candidate pool is:

```js
// public/app.js
const MAX_COMPANION_LAYOUT_ATTEMPTS = 25;

function pickBalancedCompanion(seedUpper, candidates) {
  const order = medianOutwardOrder(candidates.length).slice(0, MAX_COMPANION_LAYOUT_ATTEMPTS);
  for (const index of order) {
    const companion = candidates[index];
    if (!generateBoardFromSolutionWords([seedUpper, companion.toUpperCase()]).error) {
      return companion;
    }
  }
  return null;
}
```

No global search, no character-count comparisons, no risk of degenerating into "avoid every double letter." Just: find a real, typically-sized, board-compatible word — same spirit as a human picking a solution by hand.

## Guidance for Other Game Developers

If your game has a "beat the designer's solution" scoring mechanic:

- Decide what "canonical" is allowed to mean *before* you build a solver for it. If it just means "a reference we chose," you don't owe players (or yourself) a proof of optimality.
- Check whether your scoring metric quietly penalizes a mechanic your game is supposed to celebrate. Minimizing a raw count is an easy trap when the count itself is only low *because* a feature was avoided.
- If there's more than one legitimate way to be "good" at your game (efficient vs. elaborate, fast vs. thorough, safe vs. risky), score both directions instead of picking one as correct and staying silent about the other.
- A bounded, "good enough" search that reuses machinery you already have is usually a better trade than a purpose-built optimal solver — especially when "optimal" wasn't actually the right target to begin with.
