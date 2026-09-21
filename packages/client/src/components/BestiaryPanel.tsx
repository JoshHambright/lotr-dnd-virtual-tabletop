/**
 * The GM's bestiary and encounter shelf — never sent to a player's browser at
 * all, so stat blocks can be written up in advance and referenced mid-fight
 * without anyone catching a glimpse.
 *
 * Dropping a creature on the map creates a token linked back to its block, and
 * an encounter drops its whole roster at once, numbered, staged hidden so the
 * GM chooses the moment they appear.
 */

import { useState } from 'react'
import type { Encounter, Scene, StatBlock } from '@vtt/core'
import { newStatBlock, newToken } from '@vtt/core'
import { ABILITIES, ABILITY_NAMES, abilityModifier, formatModifier } from '@vtt/rulesets'
import type { TableClient } from '../client.js'
import { newId } from '../ids.js'

interface Props {
  client: TableClient
  bestiary: StatBlock[]
  encounters: Encounter[]
  scene: Scene | null
  openId: string | null
  onOpen: (id: string | null) => void
}

export function BestiaryPanel({ client, bestiary, encounters, scene, openId, onOpen }: Props) {
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
        hp: statBlock.maxHp,
        maxHp: statBlock.maxHp,
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
          {open ? <StatBlockEditor client={client} statBlock={open} onDeleted={() => onOpen(null)} /> : null}
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
  statBlock,
  onDeleted,
}: {
  client: TableClient
  statBlock: StatBlock
  onDeleted: () => void
}) {
  const patch = (value: Partial<StatBlock>) =>
    client.send({ t: 'statblock.upsert', statBlock: { ...statBlock, ...value } })

  const rollAttack = (ability: string) => {
    const modifier = abilityModifier(statBlock.abilities[ability] ?? 10)
    client.roll(
      `1d20${formatModifier(modifier)}`,
      `${statBlock.name} — ${ABILITY_NAMES[ability as never] ?? ability}`,
      'normal',
      'gm',
    )
  }

  return (
    <div className="scene-editor">
      <div className="sheet__grid">
        <label className="field">
          <span>Name</span>
          <input className="input" value={statBlock.name} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <label className="field">
          <span>Kind</span>
          <input className="input" value={statBlock.kind} onChange={(event) => patch({ kind: event.target.value })} />
        </label>
        <label className="field">
          <span>Armour class</span>
          <input
            className="input"
            type="number"
            value={statBlock.armourClass}
            onChange={(event) => patch({ armourClass: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>Hit points</span>
          <input
            className="input"
            type="number"
            value={statBlock.maxHp}
            onChange={(event) => patch({ maxHp: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>Speed</span>
          <input className="input" value={statBlock.speed} onChange={(event) => patch({ speed: event.target.value })} />
        </label>
        <label className="field">
          <span>Attribute level</span>
          <input
            className="input"
            type="number"
            value={statBlock.attributeLevel}
            onChange={(event) => patch({ attributeLevel: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="sheet__abilities">
        {ABILITIES.map((key) => {
          const score = statBlock.abilities[key] ?? 10
          return (
            <div key={key} className="ability">
              <label htmlFor={`sb-${statBlock.id}-${key}`}>{ABILITY_NAMES[key]}</label>
              <input
                id={`sb-${statBlock.id}-${key}`}
                className="ability__score"
                type="number"
                value={score}
                onChange={(event) =>
                  patch({ abilities: { ...statBlock.abilities, [key]: Number(event.target.value) } })
                }
              />
              <button type="button" className="ability__mod" onClick={() => rollAttack(key)}>
                {formatModifier(abilityModifier(score))}
              </button>
            </div>
          )
        })}
      </div>

      <div className="sheet__grid">
        <label className="field">
          <span>Might</span>
          <input
            className="input"
            type="number"
            value={statBlock.might}
            onChange={(event) => patch({ might: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>Resolve</span>
          <input
            className="input"
            type="number"
            value={statBlock.resolve}
            onChange={(event) => patch({ resolve: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>Hate / Despair</span>
          <input
            className="input"
            type="number"
            value={statBlock.hateOrDespair}
            onChange={(event) => patch({ hateOrDespair: Number(event.target.value) })}
          />
        </label>
      </div>

      <label className="field field--wide">
        <span>Attacks</span>
        <textarea
          className="input input--area"
          value={statBlock.attacks}
          onChange={(event) => patch({ attacks: event.target.value })}
        />
      </label>
      <label className="field field--wide">
        <span>Special abilities</span>
        <textarea
          className="input input--area"
          value={statBlock.specials}
          onChange={(event) => patch({ specials: event.target.value })}
        />
      </label>
      <label className="field field--wide">
        <span>Notes</span>
        <textarea
          className="input input--area"
          value={statBlock.notes}
          onChange={(event) => patch({ notes: event.target.value })}
        />
      </label>

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
