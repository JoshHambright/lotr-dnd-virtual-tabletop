/**
 * Everyone's sheets in one place. Players edit their own and read the rest,
 * which is what the shared Drive folder was doing, minus the part where three
 * copies drift apart between sessions.
 */

import type { Character, Scene } from '@vtt/core'
import { identityFor, newCharacter, newToken } from '@vtt/core'
import type { RulesetPack } from '@vtt/rulesets'
import { asTrack } from './SheetFields.js'
import type { TableClient } from '../client.js'
import { CharacterSheet } from './CharacterSheet.js'
import { newId } from '../ids.js'

interface Props {
  client: TableClient
  pack: RulesetPack
  characters: Character[]
  scene: Scene | null
  openId: string | null
  onOpen: (id: string | null) => void
}

export function CharactersPanel({ client, pack, characters, scene, openId, onOpen }: Props) {
  // Ownership is checked by id, never by name. See CLAUDE.md and D-017.
  const me = identityFor(client.name)
  const open = characters.find((character) => character.id === openId) ?? null
  const mine = characters.filter((character) => character.ownerId === me)

  const create = () => {
    const id = newId()
    client.send({ t: 'character.upsert', character: newCharacter(id, client.name, client.name) })
    onOpen(id)
  }

  const placeOnMap = (character: Character) => {
    if (!scene) return
    // The pack says which track is hit points; a pack that names none gets a
    // token with no bar rather than a guess about which number matters.
    const track = pack.tokenDefaults.hpTrack ? asTrack(character.values[pack.tokenDefaults.hpTrack]) : null
    client.send({
      t: 'token.create',
      token: newToken(newId(), scene.id, scene.width / 2, scene.height / 2, {
        label: character.name,
        characterId: character.id,
        hp: track ? track.value : null,
        maxHp: track ? track.max : null,
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
          const isMine = character.ownerId === me
          return (
            <li key={character.id} className={character.id === openId ? 'scene-list__item--editing' : undefined}>
              <button
                type="button"
                className="scene-list__name"
                onClick={() => onOpen(character.id === openId ? null : character.id)}
              >
                {character.name}
                <span className="hint">
                  {summarise(pack, character) || 'Unwritten'}
                  {isMine ? ' · yours' : ` · ${character.ownerName}`}
                </span>
              </button>
              <button
                type="button"
                className="button button--small"
                disabled={!scene}
                onClick={() => placeOnMap(character)}
              >
                To map
              </button>
            </li>
          )
        })}
        {characters.length === 0 ? <li className="roll-log__empty">No sheets yet.</li> : null}
      </ul>

      {open ? (
        <>
          <CharacterSheet
            client={client}
            pack={pack}
            character={open}
            editable={client.role === 'gm' || open.ownerId === me}
          />
          {client.role === 'gm' || open.ownerId === me ? (
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

/**
 * A one-line description under a name in the list.
 *
 * Built from whichever of the pack's first two `select` fields the sheet has
 * filled in — Culture and Calling in `lotr5e`, Class in another pack — because
 * hardcoding "culture · calling" here would put the ruleset back in the app.
 */
function summarise(pack: RulesetPack, character: Character): string {
  const selects = pack.sheet.sections
    .flatMap((section) => section.fields)
    .filter((field) => field.kind === 'select')
    .slice(0, 2)

  return selects
    .map((field) => character.values[field.key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' · ')
}
