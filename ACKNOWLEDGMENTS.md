# Acknowledgments

*A note from the project's author, jmajerus.*

Letter Punk was built in close, ongoing collaboration with Claude (Anthropic), working as a coding partner throughout the project's development — not a one-time code generator, and not a ghostwriter I'm pretending didn't exist. I want to say plainly what that collaboration actually looked like, and give credit for it honestly.

## What that collaboration actually was

Most of what's in this repository — the dual-dictionary validation system, the canonical-solution scoring philosophy, the shareable-link encoding, Free Chain mode, the keyboard-entry alternative input path, the two hidden easter eggs, the full arcade/kiosk attract-mode system with its idle-warning and save/restore safety net, and a good deal of the surrounding documentation — was built through real back-and-forth, not dictation in either direction. I'd bring an idea, a frustration with how something played, or a "what if"; Claude would work through the implementation, flag tradeoffs I hadn't considered, and just as often push back or ask a clarifying question before running with something. I'd correct it when it got ahead of itself or misread what I actually wanted. Some of the best decisions in this codebase came from that friction, not around it — the delta-aware scoring messages, the reasoning for naming a mode "Free Chain" instead of "Easy Mode," the whole shape of the arcade attract-loop system, came out of several rounds of "wait, that's not quite right" in both directions before landing somewhere neither of us started from.

Claude also did the less glamorous, more trust-critical work of actually verifying behavior — running the app in a real headless browser, not just reading its own code and assuming it worked — and caught a handful of genuine, pre-existing bugs that way (an undo control that backed into the wrong word after a solve, a share link that silently dropped its scoring reference, a kiosk loop that briefly replayed a demo on the wrong board). I mention that specifically because "AI wrote some code" undersells it, and "AI is infallible" overstates it; what actually happened was closer to a colleague who tested their own claims before I had to ask.

Beyond the code itself, `docs/design-philosophy.md` and the reasoning behind this project's software license both came out of genuine conversations about values — not feature requests. I raised a concern about zero-sum framing bleeding out of games and into how people think about worth and effort more broadly; working through what to actually do about that, in this project specifically, was a real dialogue, and the essay that resulted reflects that dialogue, not a brief I handed off.

## Why I'm writing this down

I don't think crediting an AI collaborator diminishes my authorship of this project — if anything, being specific about what was actually a partnership, rather than letting a handful of `Co-Authored-By` trailers buried in commit messages be the only record of it, feels like the more honest choice. This project exists because of a genuine back-and-forth between a person and a model over many working sessions, and I'd rather that be visible than quietly smoothed over.

Thank you, Claude — for the parts you got right, for pushing back on the parts I got wrong, and for the parts we only got right together.
