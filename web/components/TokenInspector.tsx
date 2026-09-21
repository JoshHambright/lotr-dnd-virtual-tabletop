/** Editing the piece currently picked up off the map. */

import type { Character, Scene, StatBlock, Token } from '../../shared/state.js'
import { TOKEN_COLORS } from '../../shared/state.js'
import type { TableClient } from '../client.js'

const CONDITIONS = [
  'Weary',
  'Miserable',
  'Poisoned',
  'Prone',
  'Frightened',
  'Grappled',
  'Restrained',
  'Stunned',
  'Blinded',
]

interface Props {
  client: TableClient
  token: Token
  scene: Scene
  statBlock: StatBlock | null
  character: Character | null
  onOpenStatBlock: (id: string) => void
}

export function TokenInspector({ client, token, statBlock, character, onOpenStatBlock }: Props) {
  const isGm = client.role === 'gm'
  const patch = (value: Partial<Token>) => client.send({ t: 'token.update', id: token.id, patch: value })

  const toggleCondition = (condition: string) => {
    const next = token.conditions.includes(condition)
      ? token.conditions.filter((c) => c !== condition)
      : [...token.conditions, condition]
    patch({ conditions: next })
  }

  return (
    <div className="panel token-inspector">
      <h3>{token.label || 'Token'}</h3>

      {isGm ? (
        <>
          <div className="field">
            <label htmlFor="token-label">Label</label>
            <input
              id="token-label"
              className="input"
              value={token.label}
              onChange={(event) => patch({ label: event.target.value })}
            />
          </div>

          <div className="sheet__grid">
            <label className="field">
              <span>Size (squares)</span>
              <input
                className="input"
                type="number"
                min={1}
                max={8}
                value={token.squares}
                onChange={(event) => patch({ squares: Math.max(1, Number(event.target.value)) })}
              />
            </label>
            <label className="field">
              <span>Hit points</span>
              <input
                className="input"
                type="number"
                value={token.hp ?? ''}
                onChange={(event) => patch({ hp: event.target.value === '' ? null : Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Maximum</span>
              <input
                className="input"
                type="number"
                value={token.maxHp ?? ''}
                onChange={(event) => patch({ maxHp: event.target.value === '' ? null : Number(event.target.value) })}
              />
            </label>
          </div>

          <div className="swatches" role="group" aria-label="Token colour">
            {TOKEN_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch${token.color === color ? ' swatch--on' : ''}`}
                style={{ background: color }}
                aria-label={`Colour ${color}`}
                onClick={() => patch({ color })}
              />
            ))}
          </div>

          <div className="panel__actions">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={token.hidden}
                onChange={(event) => patch({ hidden: event.target.checked })}
              />
              Hidden from players
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={token.locked}
                onChange={(event) => patch({ locked: event.target.checked })}
              />
              Players cannot move it
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={token.showHpToPlayers}
                onChange={(event) => patch({ showHpToPlayers: event.target.checked })}
              />
              Players can see its hit points
            </label>
          </div>
        </>
      ) : (
        <p className="hint">
          {token.hp !== null && token.maxHp ? `${token.hp} / ${token.maxHp} hit points` : 'Drag to move.'}
        </p>
      )}

      <fieldset className="fieldset">
        <legend>Conditions</legend>
        <div className="chips">
          {CONDITIONS.map((condition) => (
            <button
              key={condition}
              type="button"
              className={`chip${token.conditions.includes(condition) ? ' chip--on' : ''}`}
              onClick={() => toggleCondition(condition)}
            >
              {condition}
            </button>
          ))}
        </div>
      </fieldset>

      {statBlock ? (
        <button type="button" className="button" onClick={() => onOpenStatBlock(statBlock.id)}>
          Open {statBlock.name}’s stat block
        </button>
      ) : null}

      {character ? <p className="hint">Sheet: {character.name}</p> : null}

      {isGm ? (
        <button
          type="button"
          className="button button--danger button--small"
          onClick={() => client.send({ t: 'token.delete', id: token.id })}
        >
          Remove from map
        </button>
      ) : null}
    </div>
  )
}
