/**
 * Rendering a `SheetSchema` — any of them.
 *
 * A pack declares two sheets in the same language: a character's and a
 * creature's. This draws either. Nothing in here knows which it is looking at,
 * which is the point — a third sheet would be a third schema, not a third
 * component.
 */

import type { DerivedSheet, Field, RollMacro, Section } from '@vtt/rulesets'
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
import type { RollHandler } from './SheetFields.js'

interface Props {
  sections: Section[]
  derived: DerivedSheet
  values: Record<string, unknown>
  editable: boolean
  onChange: (key: string, value: unknown) => void
  onRoll: RollHandler
}

export function SheetSections({ sections, derived, values, editable, onChange, onRoll }: Props) {
  return (
    <>
      {sections.map((section) => (
        <SheetSection
          key={section.id}
          section={section}
          derived={derived}
          values={values}
          editable={editable}
          onChange={onChange}
          onRoll={onRoll}
        />
      ))}
    </>
  )
}

/** Blocks lay themselves out; loose fields share a grid. */
const SELF_LAYING_OUT = new Set<Field['kind']>(['abilityBlock', 'skillList', 'repeater', 'longtext'])

function SheetSection({
  section,
  derived,
  values,
  editable,
  onChange,
  onRoll,
}: Omit<Props, 'sections'> & { section: Section }) {
  const grid = section.fields.filter((field) => !SELF_LAYING_OUT.has(field.kind))
  const blocks = section.fields.filter((field) => SELF_LAYING_OUT.has(field.kind))

  const draw = (field: Field) => (
    <SheetField
      key={field.key}
      field={field}
      derived={derived}
      values={values}
      editable={editable}
      onChange={onChange}
      onRoll={onRoll}
    />
  )

  return (
    <section className={`sheet__section${section.tone ? ` sheet__section--${section.tone}` : ''}`}>
      <h3>{section.title}</h3>
      {grid.length ? <div className="sheet__grid">{grid.map(draw)}</div> : null}
      {blocks.map(draw)}
    </section>
  )
}

export function SheetField({
  field,
  derived,
  values,
  editable,
  onChange,
  onRoll,
}: Omit<Props, 'sections'> & { field: Field }) {
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
      return <NumberField {...common} field={field} derived={derived.derived[field.key]} />
    case 'toggle':
      return <ToggleField {...common} field={field} />
    case 'select':
      return <SelectField {...common} field={field} suggestion={suggestionFor(field, values)} />
    case 'abilityBlock':
      return <AbilityBlockField {...common} field={field} views={derived.abilities[field.key] ?? []} onRoll={onRoll} />
    case 'skillList':
      return <SkillListField {...common} field={field} views={derived.skills[field.key] ?? []} onRoll={onRoll} />
    case 'track':
      return <TrackField {...common} field={field} derivedMax={derived.trackMax[field.key]} />
    case 'repeater':
      return <RepeaterField {...common} field={field} onRoll={onRoll} />
  }
}

function suggestionFor(field: Extract<Field, { kind: 'select' }>, values: Record<string, unknown>): string | undefined {
  if (!field.suggest) return undefined
  return field.suggest.map[asText(values[field.suggest.fromKey])]
}

/** The macro the pack attached to a field, if it has one. */
export function macroOf(field: Field): RollMacro | undefined {
  return 'roll' in field ? field.roll : undefined
}
