# The ruleset layer

Built for **The Lord of the Rings Roleplaying** (Free League, 5e). The 5e
chassis underneath is standard — six abilities, proficiency bonus, the usual
skill list, advantage and disadvantage — so only the Middle-earth layer needed
data of its own.

## What's encoded

**Heroic Cultures**: Bardings, Dwarves of Durin's Folk, Elves of Lindon,
Hobbits of the Shire, Men of Bree, Rangers of the North.

**Callings**: Captain, Champion, Messenger, Scholar, Treasure Hunter, Warden.

**Shadow paths**, suggested per Calling and filled in automatically when you
pick one — then editable, because the suggestion is a convenience and not a
rule the app should enforce.

**Standards of living**: Poor, Frugal, Martial, Prosperous, Rich.

**Journey roles**: Guide, Scout, Hunter, Look-out.

**Sheet fields** beyond the 5e block: Shadow points, Shadow path, Hope and Hope
maximum, Weary, Miserable, Valour, Wisdom, Virtues, Rewards, Patron, Treasure.

## What it deliberately doesn't do

It doesn't enforce any of it. Nothing checks that your Calling grants a Virtue,
nothing applies Weary to a roll, nothing tracks Shadow gain. The sheet is a
place to write things down that everyone can see, and the dice go in the log.

That's a choice rather than an omission. A VTT that argues with the GM about a
ruling is worse than one that forgets a rule, and every table houserules
something.

## Where to correct it

Every enumerated list above is a dropdown that also accepts a value it doesn't
know — if your table uses a culture or Calling from a supplement, type it and it
stays. The lists live in `shared/ruleset.ts` and are ordinary arrays; adding to
them is a one-line change.

Two specifics worth flagging, because they were set from what could be verified
rather than from the book:

- **Shadow path per Calling** is a plausible mapping, not a checked one. If your
  book disagrees, `SHADOW_PATHS` in `shared/ruleset.ts` is the single place to
  fix it.
- **Hope and Valour/Wisdom** are plain numbers with no derived behaviour. If
  your table tracks them differently, they're just fields.

The skills list is standard 5e. If your game uses a different set, editing
`SKILLS` changes both the sheet and what the skill buttons roll.

## Other Middle-earth systems

The dice engine takes any expression — `2d6+3`, `4d6kh3`, `d12+3d6` — so a
system built on different dice can use the roller as-is. What is 5e-specific is
the character sheet's shape and the advantage/disadvantage buttons.

For **The One Ring 2e**, the d12 Feat die needs its own faces (the Gandalf rune
and the Eye) and Success dice need their tengwar; that's a real piece of work in
the dice renderer rather than a configuration change. For **Adventures in
Middle-earth**, the sheet is close enough that swapping the culture and Calling
lists would get most of the way.
