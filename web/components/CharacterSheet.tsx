/**
 * A character sheet the whole table can see.
 *
 * Everything on it rolls: clicking an ability or a skill sends the roll to the
 * shared log rather than opening a private calculator, which is the point of
 * having the sheets here instead of in a shared Drive folder.
 *
 * Edits save as you type, debounced, because a sheet that needs a Save button
 * is a sheet that ends the session out of date.
 */

import { useEffect, useId as useReactId, useRef, useState } from 'react'
import type { Character } from '../../shared/state.js'
import {
  ABILITIES,
  ABILITY_NAMES,
  CALLINGS,
  HEROIC_CULTURES,
  JOURNEY_ROLES,
  SHADOW_PATHS,
  SKILLS,
  STANDARDS_OF_LIVING,
  abilityModifier,
  formatModifier,
  proficiencyBonus,
} from '../../shared/ruleset.js'
import type { TableClient } from '../client.js'

const SAVE_DEBOUNCE_MS = 400

interface Props {
  client: TableClient
  character: Character
  editable: boolean
}

export function CharacterSheet({ client, character, editable }: Props) {
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

  const update = (patch: Partial<Character>) => {
    if (!editable) return
    dirtyRef.current = true
    setDraft((current) => ({ ...current, ...patch }))
  }

  const proficiency = proficiencyBonus(draft.level)
  const weariness = draft.weary ? ' (Weary)' : ''

  const rollAbility = (key: string) => {
    const modifier = abilityModifier(draft.abilities[key] ?? 10)
    client.roll(
      `1d20${formatModifier(modifier)}`,
      `${draft.name} — ${ABILITY_NAMES[key as never] ?? key}`,
      'normal',
      'public',
    )
  }

  const rollSkill = (key: string, name: string, ability: string) => {
    const rank = draft.skillProficiency[key] ?? 0
    const modifier = abilityModifier(draft.abilities[ability] ?? 10) + proficiency * rank
    client.roll(`1d20${formatModifier(modifier)}`, `${draft.name} — ${name}${weariness}`, 'normal', 'public')
  }

  return (
    <div className="sheet">
      <div className="sheet__identity">
        <Field label="Name" value={draft.name} onChange={(name) => update({ name })} readOnly={!editable} />
        <Select
          label="Heroic Culture"
          value={draft.culture}
          options={HEROIC_CULTURES}
          onChange={(culture) => update({ culture })}
          readOnly={!editable}
        />
        <Select
          label="Calling"
          value={draft.calling}
          options={CALLINGS}
          onChange={(calling) => update({ calling, shadowPath: SHADOW_PATHS[calling] ?? draft.shadowPath })}
          readOnly={!editable}
        />
        <NumberField
          label="Level"
          value={draft.level}
          min={1}
          max={20}
          onChange={(level) => update({ level })}
          readOnly={!editable}
        />
        <div className="sheet__derived">
          <span>Proficiency</span>
          <strong>{formatModifier(proficiency)}</strong>
        </div>
      </div>

      <section className="sheet__section">
        <h3>Abilities</h3>
        <div className="sheet__abilities">
          {ABILITIES.map((key) => {
            const score = draft.abilities[key] ?? 10
            return (
              <div key={key} className="ability">
                <label htmlFor={`${draft.id}-${key}`}>{ABILITY_NAMES[key]}</label>
                <input
                  id={`${draft.id}-${key}`}
                  className="ability__score"
                  type="number"
                  value={score}
                  readOnly={!editable}
                  onChange={(event) => update({ abilities: { ...draft.abilities, [key]: Number(event.target.value) } })}
                />
                <button type="button" className="ability__mod" onClick={() => rollAbility(key)}>
                  {formatModifier(abilityModifier(score))}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="sheet__section">
        <h3>Standing</h3>
        <div className="sheet__grid">
          <NumberField
            label="Hit points"
            value={draft.currentHp}
            onChange={(currentHp) => update({ currentHp })}
            readOnly={!editable}
          />
          <NumberField
            label="Maximum"
            value={draft.maxHp}
            onChange={(maxHp) => update({ maxHp })}
            readOnly={!editable}
          />
          <NumberField
            label="Temporary"
            value={draft.tempHp}
            onChange={(tempHp) => update({ tempHp })}
            readOnly={!editable}
          />
          <NumberField
            label="Armour class"
            value={draft.armourClass}
            onChange={(armourClass) => update({ armourClass })}
            readOnly={!editable}
          />
          <NumberField label="Speed" value={draft.speed} onChange={(speed) => update({ speed })} readOnly={!editable} />
        </div>
      </section>

      <section className="sheet__section sheet__section--shadow">
        <h3>Hope and Shadow</h3>
        <div className="sheet__grid">
          <NumberField label="Hope" value={draft.hope} onChange={(hope) => update({ hope })} readOnly={!editable} />
          <NumberField
            label="Hope maximum"
            value={draft.maxHope}
            onChange={(maxHope) => update({ maxHope })}
            readOnly={!editable}
          />
          <NumberField
            label="Shadow points"
            value={draft.shadow}
            onChange={(shadow) => update({ shadow })}
            readOnly={!editable}
          />
          <Field
            label="Shadow path"
            value={draft.shadowPath}
            onChange={(shadowPath) => update({ shadowPath })}
            readOnly={!editable}
          />
          <NumberField
            label="Valour"
            value={draft.valour}
            onChange={(valour) => update({ valour })}
            readOnly={!editable}
          />
          <NumberField
            label="Wisdom"
            value={draft.wisdom}
            onChange={(wisdom) => update({ wisdom })}
            readOnly={!editable}
          />
        </div>
        <div className="sheet__conditions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.weary}
              disabled={!editable}
              onChange={(event) => update({ weary: event.target.checked })}
            />
            Weary
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.miserable}
              disabled={!editable}
              onChange={(event) => update({ miserable: event.target.checked })}
            />
            Miserable
          </label>
        </div>
      </section>

      <section className="sheet__section">
        <h3>Skills</h3>
        <ul className="skills">
          {SKILLS.map((skill) => {
            const rank = draft.skillProficiency[skill.key] ?? 0
            const modifier = abilityModifier(draft.abilities[skill.ability] ?? 10) + proficiency * rank
            return (
              <li key={skill.key} className="skill">
                <button
                  type="button"
                  className="skill__rank"
                  disabled={!editable}
                  title="None, proficient, expertise"
                  onClick={() =>
                    update({ skillProficiency: { ...draft.skillProficiency, [skill.key]: (rank + 1) % 3 } })
                  }
                >
                  {rank === 0 ? '○' : rank === 1 ? '◉' : '◎'}
                </button>
                <span className="skill__name">{skill.name}</span>
                <span className="skill__ability">{skill.ability.toUpperCase()}</span>
                <button
                  type="button"
                  className="skill__mod"
                  onClick={() => rollSkill(skill.key, skill.name, skill.ability)}
                >
                  {formatModifier(modifier)}
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="sheet__section">
        <h3>In the world</h3>
        <div className="sheet__grid">
          <Select
            label="Standard of living"
            value={draft.standardOfLiving}
            options={STANDARDS_OF_LIVING}
            onChange={(standardOfLiving) => update({ standardOfLiving })}
            readOnly={!editable}
          />
          <Select
            label="Journey role"
            value={draft.journeyRole}
            options={JOURNEY_ROLES}
            onChange={(journeyRole) => update({ journeyRole })}
            readOnly={!editable}
          />
          <Field label="Patron" value={draft.patron} onChange={(patron) => update({ patron })} readOnly={!editable} />
          <Field
            label="Treasure"
            value={draft.treasure}
            onChange={(treasure) => update({ treasure })}
            readOnly={!editable}
          />
        </div>
      </section>

      <Text label="Virtues" value={draft.virtues} onChange={(virtues) => update({ virtues })} readOnly={!editable} />
      <Text label="Rewards" value={draft.rewards} onChange={(rewards) => update({ rewards })} readOnly={!editable} />
      <Text
        label="Features and feats"
        value={draft.features}
        onChange={(features) => update({ features })}
        readOnly={!editable}
      />
      <Text
        label="Equipment"
        value={draft.equipment}
        onChange={(equipment) => update({ equipment })}
        readOnly={!editable}
      />
      <Text label="Notes" value={draft.notes} onChange={(notes) => update({ notes })} readOnly={!editable} />

      {client.role === 'gm' ? (
        <Text
          label="GM notes (only you can see these)"
          value={draft.gmNotes}
          onChange={(gmNotes) => update({ gmNotes })}
          readOnly={false}
        />
      ) : null}
    </div>
  )
}

// --- Small form pieces -------------------------------------------------------

function Field({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  readOnly: boolean
}) {
  const id = useId(label)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  readOnly,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  readOnly: boolean
  min?: number
  max?: number
}) {
  const id = useId(label)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="number"
        value={value}
        readOnly={readOnly}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

function Select({
  label,
  value,
  options,
  onChange,
  readOnly,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  readOnly: boolean
}) {
  const id = useId(label)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        value={value}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {value && !options.includes(value) ? <option value={value}>{value}</option> : null}
      </select>
    </div>
  )
}

function Text({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  readOnly: boolean
}) {
  const id = useId(label)
  return (
    <div className="field field--wide">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="input input--area"
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

/**
 * Stable per-instance ids so a label points at its own control even when two
 * sheets are open. React supplies the unique part; the seed only makes the id
 * readable in the DOM inspector.
 */
function useId(seed: string): string {
  return `${seed.replace(/\W+/g, '-').toLowerCase()}-${useReactId()}`
}
