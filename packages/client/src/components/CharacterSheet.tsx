/**
 * A character sheet the whole table can see — drawn from the pack, not from a
 * component that knows what game this is.
 *
 * Everything on it rolls: clicking an ability or a skill sends the roll to the
 * shared log rather than opening a private calculator, which is the point of
 * having the sheets here instead of in a shared Drive folder.
 *
 * Edits save as you type, debounced, because a sheet that needs a Save button
 * is a sheet that ends the session out of date.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Character } from '@vtt/core'
import type { Field, RollMacro, RulesetPack, Section } from '@vtt/rulesets'
import { deriveSheet, resolveMacro } from '@vtt/rulesets'
import type { TableClient } from '../client.js'
import {
  AbilityBlockField,
  LongTextField,
  NumberField,
  RepeaterField,
  SelectField,
  SkillListField,
  TextField,
  ToggleField,
  TrackField,
  asText,
} from './SheetFields.js'

const SAVE_DEBOUNCE_MS = 400

interface Props {
  client: TableClient
  pack: RulesetPack
  character: Character
  editable: boolean
}

export function CharacterSheet({ client, pack, character, editable }: Props) {
  const [draft, setDraft] = useState(character)
  const dirtyRef = useRef(false)

  // Adopt changes from the server unless this browser is mid-edit, so two
  // people on the same sheet do not fight over the cursor.
  useEffect(() => {
    if (!dirtyRef.current) setDraft(character)
  }, [character])

  useEffect(() => {
    if (!dirtyRef.current) return
    const timer = setTimeout(() => {
      client.send({ t: 'character.upsert', character: draft })
      dirtyRef.current = false
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [client, draft])

  const sheet = useMemo(() => deriveSheet(pack.sheet, draft.values), [pack, draft.values])

  const setValue = (key: string, value: unknown) => {
    if (!editable) return
    dirtyRef.current = true
    setDraft((current) => ({ ...current, values: { ...current.values, [key]: value } }))
  }

  const setName = (name: string) => {
    if (!editable) return
    dirtyRef.current = true
    setDraft((current) => ({ ...current, name }))
  }

  /**
   * Rolls a field's macro.
   *
   * `@total` is the modifier the field just computed; everything else on the
   * sheet is in scope too, so a pack can write a macro against any of it.
   */
  const roll = (macro: RollMacro, rowLabel: string, total: number) => {
    const active = activeModifiers(pack, draft.values)
    const bonus = active.reduce(
      (sum, modifier) => sum + (modifier.effect.kind === 'bonus' ? modifier.effect.value : 0),
      0,
    )

    let expression: string
    try {
      expression = resolveMacro(macro, { ...draft.values, ...sheet.derived, total: total + bonus })
    } catch {
      // A macro the dice parser refuses is a pack bug, not the table's problem.
      return
    }

    const notes = active
      .filter((modifier) => modifier.effect.kind !== 'bonus')
      .map((modifier) => (modifier.unverified ? `${modifier.label}?` : modifier.label))
    const suffix = notes.length ? ` (${notes.join(', ')})` : ''

    client.roll(expression, `${draft.name} — ${rowLabel}${suffix}`, 'normal', macro.visibility ?? 'public')
  }

  return (
    <div className="sheet">
      <div className="sheet__identity">
        <div className="field">
          <label htmlFor={`${draft.id}-name`}>Name</label>
          <input
            id={`${draft.id}-name`}
            className="input"
            value={draft.name}
            readOnly={!editable}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>

      {pack.sheet.sections.map((section) => (
        <SheetSection
          key={section.id}
          section={section}
          sheet={sheet}
          values={draft.values}
          editable={editable}
          onChange={setValue}
          onRoll={roll}
        />
      ))}

      {sheet.problems.length ? (
        <p className="hint hint--warn">
          This sheet has a formula it cannot work out: {sheet.problems.join('; ')}. The numbers it feeds are showing 0.
        </p>
      ) : null}

      {client.role === 'gm' ? (
        <div className="field field--wide">
          <label htmlFor={`${draft.id}-gm-notes`}>GM notes (only you can see these)</label>
          <textarea
            id={`${draft.id}-gm-notes`}
            className="input input--area"
            value={draft.gmNotes}
            onChange={(event) => {
              dirtyRef.current = true
              setDraft((current) => ({ ...current, gmNotes: event.target.value }))
            }}
          />
        </div>
      ) : null}

      <p className="hint">
        {pack.name} · {pack.licence.name}
      </p>
    </div>
  )
}

function SheetSection({
  section,
  sheet,
  values,
  editable,
  onChange,
  onRoll,
}: {
  section: Section
  sheet: ReturnType<typeof deriveSheet>
  values: Record<string, unknown>
  editable: boolean
  onChange: (key: string, value: unknown) => void
  onRoll: (macro: RollMacro, rowLabel: string, total: number) => void
}) {
  // Blocks lay themselves out; loose fields share a grid.
  const grid = section.fields.filter((field) => !SELF_LAYING_OUT.has(field.kind))
  const blocks = section.fields.filter((field) => SELF_LAYING_OUT.has(field.kind))

  return (
    <section className={`sheet__section${section.tone ? ` sheet__section--${section.tone}` : ''}`}>
      <h3>{section.title}</h3>
      {grid.length ? (
        <div className="sheet__grid">
          {grid.map((field) => (
            <SheetField
              key={field.key}
              field={field}
              sheet={sheet}
              values={values}
              editable={editable}
              onChange={onChange}
              onRoll={onRoll}
            />
          ))}
        </div>
      ) : null}
      {blocks.map((field) => (
        <SheetField
          key={field.key}
          field={field}
          sheet={sheet}
          values={values}
          editable={editable}
          onChange={onChange}
          onRoll={onRoll}
        />
      ))}
    </section>
  )
}

const SELF_LAYING_OUT = new Set<Field['kind']>(['abilityBlock', 'skillList', 'repeater', 'longtext'])

function SheetField({
  field,
  sheet,
  values,
  editable,
  onChange,
  onRoll,
}: {
  field: Field
  sheet: ReturnType<typeof deriveSheet>
  values: Record<string, unknown>
  editable: boolean
  onChange: (key: string, value: unknown) => void
  onRoll: (macro: RollMacro, rowLabel: string, total: number) => void
}) {
  // `field` is passed into each case rather than spread from a shared object,
  // so the switch narrows it and each component gets the kind it declares.
  const common = {
    value: values[field.key],
    readOnly: !editable,
    onChange: (value: unknown) => onChange(field.key, value),
  }

  switch (field.kind) {
    case 'text':
      return <TextField {...common} field={field} />
    case 'longtext':
      return <LongTextField {...common} field={field} />
    case 'number':
      return <NumberField {...common} field={field} derived={sheet.derived[field.key]} />
    case 'toggle':
      return <ToggleField {...common} field={field} />
    case 'select':
      return <SelectField {...common} field={field} suggestion={suggestionFor(field, values)} />
    case 'abilityBlock':
      return <AbilityBlockField {...common} field={field} views={sheet.abilities[field.key] ?? []} onRoll={onRoll} />
    case 'skillList':
      return <SkillListField {...common} field={field} views={sheet.skills[field.key] ?? []} onRoll={onRoll} />
    case 'track':
      return <TrackField {...common} field={field} derivedMax={sheet.trackMax[field.key]} />
    case 'repeater':
      return <RepeaterField {...common} field={field} onRoll={onRoll} />
  }
}

function suggestionFor(field: Extract<Field, { kind: 'select' }>, values: Record<string, unknown>): string | undefined {
  if (!field.suggest) return undefined
  return field.suggest.map[asText(values[field.suggest.fromKey])]
}

/**
 * Which of the pack's roll modifiers apply right now.
 *
 * Only `bonus` is actually applied to the roll — it is arithmetic. The other
 * two need the dice engine to know about rerolls and floors, so for now they
 * are named on the roll instead, which is at least honest at the table (D-022).
 */
function activeModifiers(pack: RulesetPack, values: Record<string, unknown>) {
  return (pack.dice.modifiers ?? []).filter((modifier) => Boolean(values[modifier.whenField]))
}
