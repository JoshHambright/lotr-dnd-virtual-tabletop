# Ruleset packs

A pack is **data, not code**. The client renders whatever a pack declares, so a
fourth system is a new pack rather than a change to the app.

This document is the contract. It freezes at the end of Phase 0; after that it
is append-only until the phase closes, because six workstreams are coding
against it at once.

## The pack

```ts
interface RulesetPack {
  id: string // 'srd5e' | 'lotr5e' | 'morkborg'
  name: string // shown when creating a table
  version: string // semver; bumped when the schema changes
  summary: string

  licence: Licence // rendered in-app; never optional
  theme: ThemeTokens
  dice: DiceProfile
  sheet: SheetSchema
  conditions: Condition[]
  tokenDefaults: TokenDefaults
  content?: ContentIndex // optional bundled monsters, spells, gear
}
```

### Licence

Not optional, and rendered in the app rather than buried in a file, because two
of the three packs require attribution as a condition of use.

```ts
interface Licence {
  name: string // 'CC-BY-4.0' | 'MÖRK BORG Third Party License' | 'Unofficial — structure only'
  url?: string
  /** Verbatim text the licence obliges us to display. Shown in the About panel. */
  notice: string
  /** True when the licence grants use of a compatibility logo we ship. */
  compatibilityLogo?: string // asset path
}
```

## Theme tokens

A pack restyles the app by declaring custom properties. The client sets
`data-ruleset="<id>"` on the root and the tokens cascade — no per-pack CSS files
and no conditional class names in components.

```ts
interface ThemeTokens {
  /** CSS custom properties, without the leading '--'. */
  colors: Record<string, string> // ink, surface, raised, rule, accent, danger…
  fonts: { display: string; body: string; mono: string }
  /** Openly licensed font families to load. We ship no commercial typefaces. */
  webfonts?: { family: string; href: string }[]
  radius: string
  /** Optional surface treatment: 'flat' | 'parchment' | 'xerox' */
  texture?: string
}
```

**Homage, not reproduction.** A skin evokes a system's feel with open fonts and
original layout. We ship no publisher's art, typefaces or trade dress. Where a
licence grants a compatibility logo, that logo is the only mark of theirs we use.

## Dice profile

Where the systems genuinely diverge, and the reason a shared dice engine needed
a per-pack layer.

```ts
interface DiceProfile {
  /** The die a bare test rolls. */
  defaultDie: number

  /**
   * How a favourable roll is expressed.
   *  'keep-highest'  — 5e: 2d20kh1
   *  'flat-bonus'    — MÖRK BORG: a situational + or − to the roll
   *  'none'
   */
  advantageModel: 'keep-highest' | 'flat-bonus' | 'none'
  advantageBonus?: number

  /** Target-number model. 5e compares to a DC; MÖRK BORG to a DR. */
  targetLabel: string // 'DC' | 'DR'
  defaultTarget?: number // MÖRK BORG: 12

  /** Faces that read as a critical success or failure, if any. */
  criticalSuccess?: number[]
  criticalFailure?: number[]

  /** Buttons offered on the dice panel. */
  quickDice: string[]

  /**
   * Conditions that alter a roll. Declared, not hardcoded — this is where a
   * rule we could not verify becomes a one-line data fix.
   */
  modifiers?: RollModifier[]
}

interface RollModifier {
  id: string // 'weary'
  label: string
  /** Applies when this sheet field is truthy. */
  whenField: string
  /** How it changes the roll. */
  effect:
    | { kind: 'bonus'; value: number }
    | { kind: 'treat-below-as'; threshold: number; value: number }
    | { kind: 'reroll-at-or-below'; threshold: number }
  /** Set when the rule is unconfirmed, so the UI can say so rather than imply certainty. */
  unverified?: boolean
}
```

## Sheet schema

Declarative, so the client renders any pack without knowing what game it is.

```ts
interface SheetSchema {
  sections: Section[]
}

interface Section {
  id: string
  title: string
  /** Visual emphasis, e.g. the Shadow block's darker treatment. */
  tone?: 'default' | 'grim' | 'highlight'
  fields: Field[]
}

type Field =
  | { kind: 'text'; key: string; label: string; placeholder?: string }
  | { kind: 'longtext'; key: string; label: string }
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; derived?: Formula }
  | { kind: 'toggle'; key: string; label: string }
  | {
      kind: 'select'
      key: string
      label: string
      options: string[]
      allowCustom: boolean
      /** Offer a value based on another field. Never fills it in silently. */
      suggest?: { fromKey: string; map: Record<string, string>; unverified?: boolean }
    }

  /** A block of scores with modifiers and a roll button each. */
  | {
      kind: 'abilityBlock'
      key: string
      abilities: { key: string; label: string }[]
      modifier: Formula
      roll?: RollMacro
    }

  /** A proficiency-ranked list. 5e has one; MÖRK BORG has none. */
  | {
      kind: 'skillList'
      key: string
      skills: { key: string; label: string; ability: string }[]
      ranks: number
      modifier: Formula
      roll?: RollMacro
    }

  /** Current/maximum pair: hit points, Hope, Omens. */
  | { kind: 'track'; key: string; label: string; max?: Formula; resetOn?: string }

  /** Repeating rows: attacks, gear, powers. */
  | { kind: 'repeater'; key: string; label: string; fields: Field[]; roll?: RollMacro }
```

`key` is the path into the character's value bag. Character storage is a
`Record<string, unknown>`; the old fixed LotR-shaped interface is gone, and what
is left on `Character` is only what the _app_ needs — a name to put on a token,
an owner to check, a portrait, and the GM's private annotations.

### What a field stores

One shape per kind, fixed. The renderer reads defensively — a value of the
wrong shape renders as empty rather than blanking the sheet — but a pack should
expect these.

| Kind               | `values[key]`                                      |
| ------------------ | -------------------------------------------------- |
| `text`, `longtext` | `string`                                           |
| `number`           | `number`                                           |
| `toggle`           | `boolean`                                          |
| `select`           | `string`                                           |
| `abilityBlock`     | `Record<abilityKey, number>` — the scores          |
| `skillList`        | `Record<skillKey, number>` — the proficiency ranks |
| `track`            | `{ value: number; max: number }`                   |
| `repeater`         | an array of rows, each keyed by the inner fields   |

A `number` field with a `derived` formula stores nothing: it is the formula's
answer, and it renders as a value rather than a box.

The wire schema checks these shapes and their sizes, not their meaning — the
server does not know what pack a client is rendering. It deliberately accepts a
key no pack in this build declares, because dropping it would delete a sheet's
data the moment someone opened the table on an older build.

### Scoped bindings

A block field declares **one** formula for every row in it, so the row being
computed arrives as extra names in scope (D-020). Everything else resolves
against the character as usual.

| Where                   | Bound names                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `abilityBlock.modifier` | `@score` — that ability's score                                                               |
| `skillList.modifier`    | `@mod` — the governing ability's modifier; `@rank` — the proficiency rank, `0` to `ranks - 1` |
| a field's `roll`        | `@total` — the modifier that field just computed                                              |

```
floor((@score - 10) / 2)      an ability modifier, for all six
@mod + @rank * @proficiency   a skill modifier, for all seventeen
```

`@proficiency` in that second line is not a binding — it is an ordinary
reference to a derived `number` field the pack declares. A name that is bound
nowhere resolves to 0, so `@score` outside an ability block is not an error, it
is zero.

### Suggestions

```ts
suggest?: { fromKey: string; map: Record<string, string>; unverified?: boolean }
```

"When Calling is Champion, the Shadow path is usually Lure of Secrets." The app
offers it; the field stays editable; nothing is written without someone
choosing it. `unverified: true` makes the app say it is not sure, which is the
only honest way to ship a rule we could not check (D-021).

Both halves are cross-checked at validation: a suggestion keyed on a value the
source field never offers, or producing a value this field does not list, fails
the build.

### What a roll modifier does

All three kinds are applied. `bonus` is arithmetic and folds into the roll's
total; `treat-below-as` and `reroll-at-or-below` are written into the dice
expression itself (`1d20t3a0`, `1d20r1`), so the server still resolves every
roll and nothing is computed client-side (D-027).

Only dice matching the profile's `defaultDie` are affected — a rule about the
check die has no opinion about the d6s of a damage roll sharing the expression.

A modifier is still _named_ on the roll as well as applied, so the log reads
"Frodo — Stealth (Weary)" and the table can see why a number came out as it
did. One marked `unverified` gets a question mark, which is the app saying it
knows the condition is on and is not sure what the book does with it.

### Roll macros

```ts
interface RollMacro {
  label: string // '{name} — {field.label}'
  /** Dice template; '@' references resolve against sheet values. */
  expression: string // '1d20 + @mod' | '1d20 + @abilities.agility'
  visibility?: 'public' | 'gm'
}
```

## Formula grammar

Deliberately tiny. It computes derived values; it is not a scripting language,
and the moment it wants to be, the answer is a code-level pack hook instead.

```
expr    := term (('+' | '-') term)*
term    := factor (('*' | '/') factor)*
factor  := number | ref | call | '(' expr ')' | '-' factor
ref     := '@' identifier ('.' identifier)*
call    := ('floor'|'ceil'|'min'|'max'|'abs'|'clamp') '(' expr (',' expr)* ')'
```

No assignment, no conditionals, no loops, no property access beyond the value
bag, no `eval` anywhere near it. Parsed into an AST and evaluated over a plain
object, the same way the dice parser already works.

Worked examples:

```
floor((@str - 10) / 2)                  5e ability modifier
2 + floor((@level - 1) / 4)             5e proficiency bonus
@abilities.toughness                    MÖRK BORG: the ability *is* the modifier
max(1, @level)                          clamping
```

A formula that fails to parse fails CI, not a session.

## The three packs

### `srd5e` — System Reference Document 5.1 / 5.2

Licence **CC-BY-4.0**, so content may ship with attribution. Six abilities,
proficiency bonus, the standard skill list, advantage as `2d20kh1`, crit on 20,
DC as the target label. Parchment skin. Bundled content: monsters, spells,
conditions, equipment.

### `lotr5e` — The Lord of the Rings Roleplaying (Free League)

**Not open.** Structure only: field labels and sheet shape, no rules text, no
bundled content, marked unofficial in the app. The name is trademarked, so the
pack is described as compatible rather than branded.

The 5e chassis plus Heroic Culture, Calling, Shadow points and path, Hope,
Weary, Miserable, Valour, Wisdom, Standard of Living, Journey role. The vellum
skin the prototype already wears.

Carries the two unverified rules as `unverified: true` data — Shadow path per
Calling, and whether Weary alters a d20 test — so the app can show that it is
unsure instead of quietly asserting a rule.

### `morkborg` — MÖRK BORG

Published under the **MÖRK BORG Third Party License**, which permits the
compatibility logo and requires this statement, displayed in-app and on any
storefront:

> [Product name] is an independent production by [Author or Publisher] and is
> not affiliated with Ockult Örtmästare Games or Stockholm Kartell. It is
> published under the MÖRK BORG Third Party License.

Mechanically a different animal, which is exactly why it is worth having: four
abilities (Agility, Presence, Strength, Toughness, roughly −3 to +3), `d20 +
ability` against a **DR** rather than a DC, no skill list at all, Omens as a
track, armour as a damage-reduction die. Black-and-yellow brutalist skin with a
xerox texture.

_Class-specific details — the Omens die in particular — go in as pack data and
should be checked against the book by whoever runs it._

The family (CY_BORG, Pirate Borg, Vast Grimm) each have their own third-party
licences and are later packs, not assumptions baked in now.

## Validation

Every pack validates in CI against a zod schema derived from these types, and
every formula in every pack must parse. A malformed pack is a failed build.

`validatePack` also does the checks a schema cannot: field keys are unique
across the sheet (a repeater's rows are their own namespace), every skill is
governed by an ability the pack actually declares, every roll modifier's
`whenField` names a real field, and both ends of a suggestion resolve. Each of
those is a rule that would otherwise type-check, validate, and then quietly do
nothing at the table.

Packs live in `packages/rulesets/packs/<id>/` and are imported statically by
`src/registry.ts` — the same registry has to work in a browser bundle, in a
Worker and in the Node server, and none of those three agree about filesystems.
`getPack(id)` validates on first use and caches; an unknown id throws rather
than falling back to the default, because a table silently switching rulesets
is worse than a table that will not open. A GM-supplied pack is a
post-Phase-4 idea and would need sandboxing review before it is entertained —
a pack is data today precisely so that it has no way to execute anything.
