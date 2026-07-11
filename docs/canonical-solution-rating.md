# Canonical Solution Rating: Designing a Score That Doesn't Fight Your Own Mechanic

This document describes how Letter Punk rates a completed solve against a "canonical" reference solution, and why the design deliberately avoids computing the objectively best possible answer.

The short version: **"canonical" means "the solution we picked," not "the best solution that exists."** Once that's the definition, a much simpler and more game-appropriate scoring system falls out — one that rewards three different kinds of player skill instead of pushing everyone toward the same narrow answer: efficiency, elaborateness, and precision.

## The Starting Point

Letter Punk already had a `getCanonicalCharacterCount` hook (`public/modules/gameLogic.js`) that compares a player's total character count against a reference solution's, and reports whether the player came in under or matched it. It worked for daily puzzles, where a human author picks the reference words. The open question was: what should happen for boards that don't have an author-picked reference — a custom board generated on the fly from a single seed word?

The obvious-sounding answer — "compute the best possible solution and use that" — turned out to be the wrong target entirely.

## The Trap: Minimizing Characters Fights the Game's Own Identity

Letter Punk's whole pitch (see the README's "Why Letter Punk Exists") is that double letters are first-class, not excluded the way strict Letter Boxed excludes them. That matters here because of a piece of arithmetic: for a two-word chained solution covering a 12-letter board, the theoretical *minimum* character count is 13 (12 unique letters, plus one forced repeat where the second word's first letter equals the first word's last letter).

That 13 is a floor derived from pure letter-count arithmetic — not a promise that any given board can actually reach it. Hitting it requires a real dictionary word pair that partitions the board's 12 letters with zero repeats beyond that one mandatory hinge, *and* respects whatever side layout that specific board happens to have. Neither is guaranteed: some letter distributions across the four sides simply don't admit a chainable, repeat-free English word pair, so a board's true achievable minimum can sit well above 13. Wherever the floor actually lands for a specific board, the bias runs the same direction regardless: every letter reused beyond it — i.e. every double-letter tap — only ever adds to the count, never helps it.

That means a search that truly minimizes character count would first exhaust every double-letter-free word pair before ever considering one with a repeat. The "best" answer, by that metric, is specifically the answer that avoids the mechanic the game is built to celebrate. Optimizing for it would have been actively hostile to the game's own design, not neutral.

There's a second, independent argument for the same design choice — one that's about board *generation*, not scoring. For any fixed board, the set of dictionary words playable under Letter Punk's rules is a strict superset of what's playable under a no-consecutive-repeats rule: every word legal under the stricter rule stays legal here, and geminate-consonant words (LETTER, APPLE, PUZZLE, CONNECT, SUCCESS — a genuinely large slice of English) get added on top, since a double letter was their only disqualifying feature. A larger usable-word set can only enlarge the set of word-chains that can cover a given board's 12 letters, never shrink it — relaxing a constraint can add solutions but can never remove one that already existed. That holds board-by-board, not just on average: a board solvable under the stricter rule stays solvable here, but the reverse isn't guaranteed — some boards are only solvable *because* a double-letter word happens to bridge an otherwise awkward letter pairing. Allowing double letters doesn't just add flavor to word choice; it's part of what keeps more randomly generated boards playable at all.

## The Reframe

The fix wasn't a smarter search — it was rejecting the premise. "Canonical" doesn't have to mean "provably optimal." In every other case in the codebase (a daily puzzle's author-picked words, a custom board's seed-derived words), "canonical" already just means "the solution we happened to pick." Nothing about the word implies effort or optimality. Once that's accepted, there's no obligation to search exhaustively for anything — we just need to pick *a* reasonable reference, honestly, and not oversell what it is.

## Why Character Count, Not Word Count

An easy alternative would have been to score by word count instead — fewest words wins, which is closer to how NYT Letter Boxed frames "par." That axis was considered and set aside, for a reason specific to this game: word count can't see the thing being rewarded. A tight, repeat-free word pair and a long, double-letter-laden word pair can both be "two words" — identical on that axis, wildly different in what they actually demonstrate. Character count is sensitive to exactly the dimension word count is blind to.

Word count still matters when there's no canonical reference at all — a solve is called out as "Outstanding" if it lands at two words regardless of any character target — but it was never a serious contender as the *primary* comparison, precisely because a metric that can't tell a plain pair from an elaborate one can't reward elaborateness in the first place. There's also a structural reason a word-count comparison was never needed for computed boards specifically: `pickBalancedCompanion` only ever considers a single seed plus one companion — a two-word pair by construction — so there was never a competing three-word candidate to prefer against. Word count doesn't need comparing when the search itself already fixes it.

## Winning in the Center and to Either Side

The original messaging (`gameLogic.js`) only had two branches: the player beat the canonical count, or matched it. A longer solve got no acknowledgment at all — silence, as if it wasn't worth mentioning. That silence was itself a value judgment: it implicitly treated "shorter" as the only praiseworthy outcome, the same bias that made exhaustive minimization a bad idea in the first place.

The fix adds a third branch, but the more important shift is treating all three outcomes as equally deliberate goals rather than "two directions plus a tie" — each earns its own title rather than a generic exclamation, so it reads as a distinct, earned achievement instead of a canned reaction:

```js
// public/modules/gameLogic.js
if (playerCharacterCount < canonicalCharacterCount) {
  // "Efficiency Engineer: you came in under the canonical N-character solution!"
} else if (playerCharacterCount === canonicalCharacterCount) {
  // "Dead Reckoner: you matched the canonical character count exactly!"
} else if (playerCharacterCount > canonicalCharacterCount) {
  // "Vocabulary Wrangler: that's longer than the canonical N-character
  //  solution — nice work weaving in extra letters!"
}
```

- **Efficiency Engineer — shorter.** Finding the tightest possible path through the board.
- **Vocabulary Wrangler — longer.** Deliberately weaving in extra letters and repeats: the double-letter mechanic put to full use.
- **Dead Reckoner — exact match.** Reading the puzzle well enough to land squarely on the reference count on a genuine first attempt. (Dead reckoning is the navigational technique of calculating a position from careful judgment rather than direct measurement — a fitting name for landing on a target you can't see.)

These three names are a first pass, not a settled choice — worth revisiting once there's been more time to sit with them.

The exact-match case is worth calling out specifically, because it's easy to file it away as a rounding-error tie rather than a real achievement. Coming in under or exceeding the canonical count is an open target — many different word combinations satisfy "fewer than N" or "more than N." Landing on exactly N, via a word choice that isn't just the reference solution replayed after seeing it (e.g. via "Yesterday"), is a single point in a much larger space. It's likely rare for an individual player to hit it in a given playthrough, which is exactly why it earns its own message instead of folding invisibly into a generic "you solved it."

Worth separating that from a second, broader kind of rarity: the *whole three-way scoring shape* is uncommon, independent of how often any one outcome actually occurs in play. Most games pick a single axis — fewest moves, highest score, fastest time — and treat every other result as simply "didn't optimize," full stop. Rewarding efficiency, elaborateness, and precision as three equally legitimate outcomes, rather than one correct direction with silence everywhere else, is the less common design choice.

None of the three is "more correct" than the others — efficient, elaborate, and precise are just different, equally valid ways to be good at this game. This applies to every puzzle source, not just computed boards, so a daily-puzzle player who finds a longer path — or lands exactly on par — now gets a genuine compliment instead of nothing.

One honest caveat: the game can't tell — and doesn't try to tell — whether a player who lands on the canonical count was aiming for it or just got there naturally; the message fires the same either way. That doesn't make it any less real for the player who worked for it, though — as in any game that mixes luck and skill, a player usually knows which one happened, even when the game itself can't.

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

## A Worked Example

Real output from the actual seed-word flow, run against the live packed dictionary — not a hypothetical. The specific numbers below will drift slightly whenever the dictionary is rebuilt, but the shape of the result won't.

Seed: **GEAR**

`findCompanionWord` returns 105 valid candidates for this seed — dictionary words starting with R (GEAR's last letter) that combine with GEAR's own letters to total exactly 12 unique letters. Sorted shortest to longest, the pool ranges from REDUCTIONS (10 characters) to RESPONSIBILITIES (16 characters). Neither extreme is ever seriously considered.

Starting from the middle of that 105-candidate list (index 52), the very first candidate tried — REDEVELOPMENT (13 characters) — already produces a valid board layout, so the search stops immediately:

| Side | Letters |
| --- | --- |
| Top | EOT |
| Right | ALP |
| Bottom | RMN |
| Left | GDV |

GEAR + REDEVELOPMENT: 4 + 13 = **17 characters**, the canonical reference for this board. Any completed solve on it is then rated against that number:

| Player's solve | Characters | Title |
| --- | --- | --- |
| a tighter chain | fewer than 17 | Efficiency Engineer |
| GEAR + REDEVELOPMENT itself, or any other pair totaling 17 | exactly 17 | Dead Reckoner |
| a longer, double-letter-heavy chain | more than 17 | Vocabulary Wrangler |

## Reading, Not Computing

Every choice above traces back to one underlying value, worth stating directly rather than leaving implicit: **the system should reward what a well-read person could plausibly find, not what an exhaustive search could produce.**

That's why the reference solution is picked from the *middle* of the candidate pool rather than searched for at either extreme — the shortest or longest word a trie walk can dig up represents brute enumeration, not vocabulary. A typically-sized word is a much closer proxy for what a knowledgeable player would actually reach for. It's also why double letters are allowed at all: a word like COMMITTEE or MISSPELL being usable rewards someone for having read and retained it, the same kind of accumulated capital as knowing an obscure long word — excluding it wouldn't have made the game harder in an interesting way, just narrower.

The same value runs through the scoring itself. Coming in under, matching, or exceeding the canonical count are all still fundamentally acts of recall and judgment, not search — landing on the canonical count *on purpose* takes a felt sense of the puzzle built from vocabulary, not the ability to enumerate candidate words. None of the three outcomes ask a player to out-compute a machine; they ask a player to know a tighter word, know a more elaborate one, or judge the puzzle precisely enough to land on the reference on purpose — not past it, just onto it — and the reference itself was chosen the same way a person would choose it, not the way a solver would.

## Guidance for Other Game Developers

If your game has a "beat the designer's solution" scoring mechanic:

- Decide what "canonical" is allowed to mean *before* you build a solver for it. If it just means "a reference we chose," you don't owe players (or yourself) a proof of optimality.
- Check whether your scoring metric quietly penalizes a mechanic your game is supposed to celebrate. Minimizing a raw count is an easy trap when the count itself is only low *because* a feature was avoided.
- If there's more than one legitimate way to be "good" at your game (efficient vs. elaborate, fast vs. thorough, safe vs. risky), score every direction — including landing exactly on the reference — instead of picking one as correct and staying silent about the rest. The exact-match case is often the rarest of the set and deserves its own recognition, not just a tie-breaker shrug.
- A bounded, "good enough" search that reuses machinery you already have is usually a better trade than a purpose-built optimal solver — especially when "optimal" wasn't actually the right target to begin with.
