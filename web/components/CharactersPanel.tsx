/**
 * Everyone's sheets in one place. Players edit their own and read the rest,
 * which is what the shared Drive folder was doing, minus the part where three
 * copies drift apart between sessions.
 */

import type { Character, Scene } from '../../shared/state.js'
import { newCharacter, newToken } from '../../shared/state.js'
import type { TableClient } from '../client.js'
import { CharacterSheet } from './CharacterSheet.js'

interface Props {
  client: TableClient
  characters: Character[]
  scene: Scene | null
  openId: string | null
  onOpen: (id: string | null) => void
}

export function CharactersPanel({ client, characters, scene, openId, onOpen }: Props) {
  const open = characters.find((character) => character.id === openId) ?? null
  const mine = characters.filter((character) => character.ownerName === client.name)

  const create = () => {
    const id = crypto.randomUUID()
    client.send({ t: 'character.upsert', character: newCharacter(id, client.name, client.name) })
    onOpen(id)
  }

  const placeOnMap = (character: Character) => {
    if (!scene) return
    client.send({
      t: 'token.create',
      token: newToken(crypto.randomUUID(), scene.id, scene.width / 2, scene.height / 2, {
        label: character.name,
        characterId: character.id,
        hp: character.currentHp,
        maxHp: character.maxHp,
        imageAssetId: character.portraitAssetId,
      }),
    })
  }

  return (
    <div className="panel">
      <div className="panel__actions">
        <button type="button" className="button" onClick={create}>
          {mine.length ? 'Another sheet' : 'Create my sheet'}
        </button>
      </div>

      <ul className="scene-list">
        {characters.map((character) => {
          const isMine = character.ownerName === client.name
          return (
            <li key={character.id} className={character.id === openId ? 'scene-list__item--editing' : undefined}>
              <button type="button" className="scene-list__name" onClick={() => onOpen(character.id === openId ? null : character.id)}>
                {character.name}
                <span className="hint">
                  {[character.culture, character.calling].filter(Boolean).join(' · ') || 'Unwritten'}
                  {isMine ? ' · yours' : ` · ${character.ownerName}`}
                </span>
              </button>
              <button type="button" className="button button--small" disabled={!scene} onClick={() => placeOnMap(character)}>
                To map
              </button>
            </li>
          )
        })}
        {characters.length === 0 ? <li className="roll-log__empty">No sheets yet.</li> : null}
      </ul>

      {open ? (
        <>
          <CharacterSheet client={client} character={open} editable={client.role === 'gm' || open.ownerName === client.name} />
          {client.role === 'gm' || open.ownerName === client.name ? (
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => {
                client.send({ t: 'character.delete', id: open.id })
                onOpen(null)
              }}
            >
              Delete sheet
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
