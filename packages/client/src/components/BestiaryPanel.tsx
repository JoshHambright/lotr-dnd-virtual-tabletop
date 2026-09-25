/**
 * The GM's bestiary and encounter shelf — never sent to a player's browser at
 * all, so stat blocks can be written up in advance and referenced mid-fight
 * without anyone catching a glimpse.
 *
 * Dropping a creature on the map creates a token linked back to its block, and
 * an encounter drops its whole roster at once, numbered, staged hidden so the
 * GM chooses the moment they appear.
 */

import { useMemo, useState } from 'react'
import type { Encounter, Scene, StatBlock } from '@vtt/core'
import { newStatBlock, newToken } from '@vtt/core'
import type { RollMacro, RulesetPack } from '@vtt/rulesets'
import { deriveSheet, resolveMacro } from '@vtt/rulesets'
import type { TableClient } from '../client.js'
import { newId } from '../ids.js'
import { SheetSections } from './SheetSections.js'
import { asNumber, asTrack } from './SheetFields.js'

interface Props {
  client: TableClient
  pack: RulesetPack
  bestiary: StatBlock[]
  encounters: Encounter[]
  scene: Scene | null
  openId: string | null
  onOpen: (id: string | null) => void
}

export function BestiaryPanel({ client, pack, bestiary, encounters, scene, openId, onOpen }: Props) {
  const [tab, setTab] = useState<'creatures' | 'encounters'>('creatures')
  const open = bestiary.find((entry) => entry.id === openId) ?? null

  const addCreature = () => {
    const id = newId()
    client.send({ t: 'statblock.upsert', statBlock: newStatBlock(id, 'New creature') })
    onOpen(id)
  }

  /** Places a creature near the middle of the map, staged out of sight. */
  const deploy = (statBlock: StatBlock, index = 0, total = 1) => {
    if (!scene) return
    const spread = scene.grid.size * 1.2
    const offset = (index - (total - 1) / 2) * spread
    client.send({
      t: 'token.create',
      token: newToken(newId(), scene.id, scene.width / 2 + offset, scene.height / 2, {
        label: total > 1 ? `${statBlock.name} ${index + 1}` : statBlock.name,
        color: statBlock.color,
        statBlockId: statBlock.id,
        imageAssetId: statBlock.imageAssetId,
        ...creatureHp(pack, statBlock),
        showHpToPlayers: false,
        hidden: true,
      }),
    })
  }

  const deployEncounter = (encounter: Encounter) => {
    let index = 0
    const total = encounter.members.reduce((sum, member) => sum + member.count, 0)
    for (const member of encounter.members) {
      const statBlock = bestiary.find((entry) => entry.id === member.statBlockId)
      if (!statBlock) continue
      for (let i = 0; i < member.count; i++) deploy(statBlock, index++, total)
    }
  }

  return (
    <div className="panel">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`chip${tab === 'creatures' ? ' chip--on' : ''}`}
          onClick={() => setTab('creatures')}
        >
          Creatures
        </button>
        <button
          type="button"
          role="tab"
          className={`chip${tab === 'encounters' ? ' chip--on' : ''}`}
          onClick={() => setTab('encounters')}
        >
          Encounters
        </button>
      </div>

      {tab === 'creatures' ? (
        <>
          <button type="button" className="button" onClick={addCreature}>
            New creature
          </button>
          <ul className="scene-list">
            {bestiary.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="scene-list__name"
                  onClick={() => onOpen(entry.id === openId ? null : entry.id)}
                >
                  <span className="dot" style={{ background: entry.color }} />
                  {entry.name}
                </button>
                <button type="button" className="button button--small" disabled={!scene} onClick={() => deploy(entry)}>
                  Drop on map
                </button>
              </li>
            ))}
            {bestiary.length === 0 ? <li className="roll-log__empty">Nothing prepared yet.</li> : null}
          </ul>
          {open ? (
            <StatBlockEditor client={client} pack={pack} statBlock={open} onDeleted={() => onOpen(null)} />
          ) : null}
        </>
      ) : (
        <EncountersTab
          client={client}
          bestiary={bestiary}
          encounters={encounters}
          scene={scene}
          onDeploy={deployEncounter}
        />
      )}
    </div>
  )
}

function StatBlockEditor({
  client,
  pack,
  statBlock,
  onDeleted,
}: {
  client: TableClient
  pack: RulesetPack
  statBlock: StatBlock
  onDeleted: () => void
}) {
  // No debounce here, unlike the character sheet. A stat block has one editor
  // — the GM — so there is no second cursor to fight over, and a monster
  // written up mid-fight should be on the map the moment it is typed.
  const patch = (value: Partial<StatBlock>) =>
    client.send({ t: 'statblock.upsert', statBlock: { ...statBlock, ...value } })

  const derived = useMemo(() => deriveSheet(pack.statBlock, statBlock.values), [pack, statBlock.values])

  const roll = (macro: RollMacro, rowLabel: string, total: number) => {
    let expression: string
    try {
      expression = resolveMacro(macro, { ...statBlock.values, ...derived.derived, total })
    } catch {
      // A macro the dice parser refuses is a pack bug, not the GM's problem.
      return
    }
    // Behind the screen unless the pack says otherwise: a creature's to-hit
    // roll in the public log tells the table its armour class before the fight
    // has told them anything.
    client.roll(expression, `${statBlock.name} — ${rowLabel}`, 'normal', macro.visibility ?? 'gm')
  }

  return (
    <div className="scene-editor">
      <div className="sheet__grid">
        <div className="field">
          <label htmlFor={`sb-${statBlock.id}-name`}>Name</label>
          <input
            id={`sb-${statBlock.id}-name`}
            className="input"
            value={statBlock.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`sb-${statBlock.id}-color`}>Token colour</label>
          <select
            id={`sb-${statBlock.id}-color`}
            className="input"
            value={statBlock.color}
            onChange={(event) => patch({ color: event.target.value })}
          >
            {colourOptions(pack, statBlock.color).map((colour) => (
              <option key={colour} value={colour}>
                {colour}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SheetSections
        sections={pack.statBlock.sections}
        derived={derived}
        values={statBlock.values}
        editable
        onChange={(key, value) => patch({ values: { ...statBlock.values, [key]: value } })}
        onRoll={roll}
      />

      {derived.problems.length ? (
        <p className="hint hint--warn">
          This stat block has a formula it cannot work out: {derived.problems.join('; ')}.
        </p>
      ) : null}

      <button
        type="button"
        className="button button--danger button--small"
        onClick={() => {
          client.send({ t: 'statblock.delete', id: statBlock.id })
          onDeleted()
        }}
      >
        Delete creature
      </button>
    </div>
  )
}

/** The pack's token palette, plus whatever this creature is already using. */
function colourOptions(pack: RulesetPack, current: string): string[] {
  const palette = pack.tokenDefaults.colors
  return palette.includes(current) ? palette : [current, ...palette]
}

function EncountersTab({
  client,
  bestiary,
  encounters,
  scene,
  onDeploy,
}: {
  client: TableClient
  bestiary: StatBlock[]
  encounters: Encounter[]
  scene: Scene | null
  onDeploy: (encounter: Encounter) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = encounters.find((entry) => entry.id === openId) ?? null

  const add = () => {
    const id = newId()
    client.send({ t: 'encounter.upsert', encounter: { id, name: 'New encounter', notes: '', members: [] } })
    setOpenId(id)
  }

  const patch = (encounter: Encounter, value: Partial<Encounter>) =>
    client.send({ t: 'encounter.upsert', encounter: { ...encounter, ...value } })

  return (
    <>
      <button type="button" className="button" onClick={add}>
        New encounter
      </button>
      <ul className="scene-list">
        {encounters.map((encounter) => (
          <li key={encounter.id}>
            <button
              type="button"
              className="scene-list__name"
              onClick={() => setOpenId(encounter.id === openId ? null : encounter.id)}
            >
              {encounter.name}
              <span className="hint">{encounter.members.reduce((sum, m) => sum + m.count, 0)} creatures</span>
            </button>
            <button
              type="button"
              className="button button--small"
              disabled={!scene}
              onClick={() => onDeploy(encounter)}
            >
              Deploy
            </button>
          </li>
        ))}
        {encounters.length === 0 ? <li className="roll-log__empty">No encounters prepared.</li> : null}
      </ul>

      {open ? (
        <div className="scene-editor">
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              value={open.name}
              onChange={(event) => patch(open, { name: event.target.value })}
            />
          </label>

          <ul className="scene-list">
            {open.members.map((member, index) => {
              const statBlock = bestiary.find((entry) => entry.id === member.statBlockId)
              return (
                <li key={`${member.statBlockId}-${index}`}>
                  <span className="scene-list__name">{statBlock?.name ?? 'Missing creature'}</span>
                  <input
                    className="input input--tiny"
                    type="number"
                    min={1}
                    value={member.count}
                    aria-label={`How many ${statBlock?.name ?? 'creatures'}`}
                    onChange={(event) => {
                      const members = [...open.members]
                      members[index] = { ...member, count: Math.max(1, Number(event.target.value)) }
                      patch(open, { members })
                    }}
                  />
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() => patch(open, { members: open.members.filter((_, i) => i !== index) })}
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>

          <label className="field">
            <span>Add a creature</span>
            <select
              className="input"
              value=""
              onChange={(event) => {
                if (!event.target.value) return
                patch(open, { members: [...open.members, { statBlockId: event.target.value, count: 1 }] })
              }}
            >
              <option value="">Choose…</option>
              {bestiary.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--wide">
            <span>Notes</span>
            <textarea
              className="input input--area"
              value={open.notes}
              onChange={(event) => patch(open, { notes: event.target.value })}
            />
          </label>

          <button
            type="button"
            className="button button--danger button--small"
            onClick={() => {
              client.send({ t: 'encounter.delete', id: open.id })
              setOpenId(null)
            }}
          >
            Delete encounter
          </button>
        </div>
      ) : null}
    </>
  )
}

/**
 * A creature's hit points, from wherever the pack keeps them.
 *
 * A pack that names no field gets a token with no bar rather than a guess
 * about which number on the card is the one that kills it.
 */
function creatureHp(pack: RulesetPack, statBlock: StatBlock): { hp: number | null; maxHp: number | null } {
  const key = pack.tokenDefaults.statBlockHp
  if (!key) return { hp: null, maxHp: null }

  const stored = statBlock.values[key]
  const field = pack.statBlock.sections.flatMap((section) => section.fields).find((entry) => entry.key === key)
  if (field?.kind === 'track') {
    const track = asTrack(stored)
    return { hp: track.max, maxHp: track.max }
  }
  const value = asNumber(stored)
  return { hp: value, maxHp: value }
}
