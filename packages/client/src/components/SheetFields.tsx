/**
 * One component per field kind the pack format declares.
 *
 * Nothing in here knows what game is being played. A field arrives as data and
 * its value arrives as `unknown`, read defensively throughout — a sheet saved
 * by an older pack has to render rather than blank the screen.
 *
 * Each component takes its own narrowed field type rather than the union, so
 * that reaching for a property the kind does not have is a build error instead
 * of an empty label at someone's table.
 */

import { useId as useReactId } from 'react'
import type { AbilityView, Field, RollMacro, SkillView, TrackValue } from '@vtt/rulesets'
import { formatModifier } from '@vtt/rulesets'

type OfKind<K extends Field['kind']> = Extract<Field, { kind: K }>

interface Common<F> {
  field: F
  value: unknown
  onChange: (value: unknown) => void
  readOnly: boolean
}

/** Rolls a field's macro. `total` is the modifier the row just computed. */
export type RollHandler = (macro: RollMacro, rowLabel: string, total: number) => void

// --- Readers -----------------------------------------------------------------
// A value bag is storage, not a type. Everything below assumes it may be wrong.

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

export function asTrack(value: unknown): TrackValue {
  const record = asRecord(value)
  return { value: asNumber(record.value), max: asNumber(record.max) }
}

// --- Fields ------------------------------------------------------------------

export function TextField({ field, value, onChange, readOnly }: Common<OfKind<'text'>>) {
  const id = useFieldId(field.key)
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <input
        id={id}
        className="input"
        value={asText(value)}
        readOnly={readOnly}
        {...(field.placeholder ? { placeholder: field.placeholder } : {})}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export function LongTextField({ field, value, onChange, readOnly }: Common<OfKind<'longtext'>>) {
  const id = useFieldId(field.key)
  return (
    <div className="field field--wide">
      <label htmlFor={id}>{field.label}</label>
      <textarea
        id={id}
        className="input input--area"
        value={asText(value)}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export function NumberField({
  field,
  value,
  onChange,
  readOnly,
  derived,
}: Common<OfKind<'number'>> & { derived?: number | undefined }) {
  const id = useFieldId(field.key)

  // A derived field is shown, not typed into: it is the formula's answer, and
  // an editable box implying otherwise is a lie the next render corrects.
  if (derived !== undefined) {
    return (
      <div className="sheet__derived">
        <span>{field.label}</span>
        <strong>{formatModifier(derived)}</strong>
      </div>
    )
  }

  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <input
        id={id}
        className="input"
        type="number"
        value={asNumber(value)}
        readOnly={readOnly}
        {...(field.min !== undefined ? { min: field.min } : {})}
        {...(field.max !== undefined ? { max: field.max } : {})}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export function ToggleField({ field, value, onChange, readOnly }: Common<OfKind<'toggle'>>) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={value === true}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.checked)}
      />
      {field.label}
    </label>
  )
}

export function SelectField({
  field,
  value,
  onChange,
  readOnly,
  suggestion,
}: Common<OfKind<'select'>> & { suggestion?: string | undefined }) {
  const id = useFieldId(field.key)
  const current = asText(value)
  // A suggestion is offered, never applied. See DECISIONS D-021.
  const offered = suggestion && suggestion !== current ? suggestion : null

  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <select
        id={id}
        className="input"
        value={current}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">—</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {current && !field.options.includes(current) ? <option value={current}>{current}</option> : null}
      </select>
      {offered && !readOnly ? (
        <button type="button" className="hint hint--action" onClick={() => onChange(offered)}>
          Usually {offered}
          {field.suggest?.unverified ? ' — unconfirmed' : ''}
        </button>
      ) : null}
    </div>
  )
}

export function AbilityBlockField({
  field,
  value,
  onChange,
  readOnly,
  views,
  onRoll,
}: Common<OfKind<'abilityBlock'>> & { views: AbilityView[]; onRoll: RollHandler }) {
  const scores = asRecord(value)
  const macro = field.roll

  return (
    <div className="sheet__abilities">
      {views.map((ability) => (
        <div key={ability.key} className="ability">
          <label htmlFor={`${field.key}-${ability.key}`}>{ability.label}</label>
          <input
            id={`${field.key}-${ability.key}`}
            className="ability__score"
            type="number"
            value={ability.score}
            readOnly={readOnly}
            onChange={(event) => onChange({ ...scores, [ability.key]: Number(event.target.value) })}
          />
          {macro ? (
            <button
              type="button"
              className="ability__mod"
              onClick={() => onRoll(macro, ability.label, ability.modifier)}
            >
              {formatModifier(ability.modifier)}
            </button>
          ) : (
            <span className="ability__mod">{formatModifier(ability.modifier)}</span>
          )}
        </div>
      ))}
    </div>
  )
}

/** None, proficient, expertise — with a fallback for a system of more steps. */
const RANK_MARKS = ['○', '◉', '◎', '◈', '◆']

export function SkillListField({
  field,
  value,
  onChange,
  readOnly,
  views,
  onRoll,
}: Common<OfKind<'skillList'>> & { views: SkillView[]; onRoll: RollHandler }) {
  const ranks = asRecord(value)
  const macro = field.roll

  return (
    <ul className="skills">
      {views.map((skill) => (
        <li key={skill.key} className="skill">
          <button
            type="button"
            className="skill__rank"
            disabled={readOnly}
            title={`${field.ranks} steps; click to cycle`}
            onClick={() => onChange({ ...ranks, [skill.key]: (skill.rank + 1) % field.ranks })}
          >
            {RANK_MARKS[skill.rank] ?? skill.rank}
          </button>
          <span className="skill__name">{skill.label}</span>
          <span className="skill__ability">{skill.ability.toUpperCase()}</span>
          {macro ? (
            <button type="button" className="skill__mod" onClick={() => onRoll(macro, skill.label, skill.modifier)}>
              {formatModifier(skill.modifier)}
            </button>
          ) : (
            <span className="skill__mod">{formatModifier(skill.modifier)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function TrackField({
  field,
  value,
  onChange,
  readOnly,
  derivedMax,
}: Common<OfKind<'track'>> & { derivedMax?: number | undefined }) {
  const id = useFieldId(field.key)
  const track = asTrack(value)

  return (
    <div className="field field--track">
      <label htmlFor={id}>{field.label}</label>
      <div className="track">
        <input
          id={id}
          className="input input--track"
          type="number"
          value={track.value}
          readOnly={readOnly}
          onChange={(event) => onChange({ value: Number(event.target.value), max: track.max })}
        />
        <span className="track__of">/</span>
        {derivedMax === undefined ? (
          <input
            className="input input--track"
            type="number"
            aria-label={`${field.label} maximum`}
            value={track.max}
            readOnly={readOnly}
            onChange={(event) => onChange({ value: track.value, max: Number(event.target.value) })}
          />
        ) : (
          <strong className="track__max">{derivedMax}</strong>
        )}
      </div>
    </div>
  )
}

export function RepeaterField({
  field,
  value,
  onChange,
  readOnly,
  onRoll,
}: Common<OfKind<'repeater'>> & { onRoll: RollHandler }) {
  const rows = asRows(value)
  const macro = field.roll

  const setRow = (index: number, patch: Record<string, unknown>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))

  return (
    <div className="repeater">
      <div className="repeater__label">{field.label}</div>
      {rows.map((row, index) => (
        // Rows carry no id and cannot be reordered, so the index is identity.
        <div key={index} className="repeater__row">
          {field.fields.map((column) => (
            <SimpleCell
              key={column.key}
              field={column}
              value={row[column.key]}
              readOnly={readOnly}
              onChange={(next) => setRow(index, { [column.key]: next })}
            />
          ))}
          {macro ? (
            <button
              type="button"
              className="button button--small"
              onClick={() => onRoll(macro, asText(row.name) || field.label, asNumber(row.bonus))}
            >
              Roll
            </button>
          ) : null}
          {readOnly ? null : (
            <button
              type="button"
              className="button button--small button--danger"
              aria-label={`Remove ${asText(row.name) || 'row'}`}
              onClick={() => onChange(rows.filter((_, at) => at !== index))}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {readOnly ? null : (
        <button type="button" className="button button--small" onClick={() => onChange([...rows, {}])}>
          Add {field.label.toLowerCase()}
        </button>
      )}
    </div>
  )
}

/**
 * A repeater's columns.
 *
 * Only the flat kinds render inside a row. A repeater of ability blocks is a
 * shape nobody has asked for, and every nesting level the renderer supports is
 * another way for a pack to draw something unusable.
 */
function SimpleCell({ field, value, onChange, readOnly }: Common<Field>) {
  switch (field.kind) {
    case 'text':
      return <TextField field={field} value={value} onChange={onChange} readOnly={readOnly} />
    case 'longtext':
      return <LongTextField field={field} value={value} onChange={onChange} readOnly={readOnly} />
    case 'number':
      return <NumberField field={field} value={value} onChange={onChange} readOnly={readOnly} />
    case 'toggle':
      return <ToggleField field={field} value={value} onChange={onChange} readOnly={readOnly} />
    case 'select':
      return <SelectField field={field} value={value} onChange={onChange} readOnly={readOnly} />
    default:
      return null
  }
}

/**
 * Stable per-instance ids so a label points at its own control even when two
 * sheets are open. React supplies the unique part; the seed only makes the id
 * readable in the DOM inspector.
 */
function useFieldId(seed: string): string {
  return `${seed.replace(/\W+/g, '-').toLowerCase()}-${useReactId()}`
}
