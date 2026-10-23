# Design rules

Standing rules for every page in HelixOS, whoever builds it.

## Important actions are buttons, never small links (H-1794)

Anything a member or coach has to find to finish a step is a button: a next step, an upload, a setting they need, the way to their pass ("Open Rewards", "Add to wallet", "Fix my pass"), My reports, Help and support.

- Use the shared button classes in `src/app/globals.css`:
  - `btn btn-accent` (gold) for the main action;
  - `btn btn-ghost` (outline) for a secondary one;
  - add `btn-sm` where space is tight.
- Every such button gets `min-h-11!`, a 44 px tap target, and must read at 390 px. The `!` matters: `.btn-sm` and `.btn-xs` set their own smaller minimum, which a plain `min-h-11` does not beat.
- A card has one gold button at most. The step's main action is the most visible thing on the card.
- Small text links are only for extras nobody needs to find: legal pages, a sort order, "Do this later".
- When you touch a page, upgrade any important small link you find, and list it in your Ready.
