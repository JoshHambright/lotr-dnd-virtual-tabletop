/**
 * The dice controls and the shared roll log.
 *
 * The log is the honesty mechanism: every public roll lands here for everyone,
 * in order, with the individual faces shown rather than just a total. Nothing
 * in the client can write to it — entries only arrive from the server.
 */

import { useEffect, useState } from 'react'
import type { Roll } from '@vtt/core'
import type { RollMode } from '@vtt/dice'
import { criticalKind } from '@vtt/dice'
import type { TableClient } from '../client.js'
import { RollDetail } from './RollDetail.js'

const QUICK_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']

/**
 * Die colours. Chosen to stay apart from each other at the size a die is
 * actually drawn, and to sit against the chrome's cool greys rather than
 * fighting them.
 */
const DIE_COLORS = [
  { name: 'Slate', value: '#606470' },
  { name: 'Ember', value: '#b4553f' },
  { name: 'Moss', value: '#5d7f4e' },
  { name: 'Delft', value: '#4a6f9e' },
  { name: 'Plum', value: '#7a5480' },
  { name: 'Brass', value: '#a8823c' },
  { name: 'Teal', value: '#3f7f77' },
  { name: 'Bone', value: '#d8d2c4' },
]

const COLOR_KEY = 'vtt.dieColor'

function storedColor(): string {
  try {
    const saved = localStorage.getItem(COLOR_KEY)
    if (saved && /^#[0-9a-f]{6}$/i.test(saved)) return saved
  } catch {
    // Private browsing, or storage refused. A default is fine.
  }
  return DIE_COLORS[0]!.value
}

interface Props {
  client: TableClient
  rolls: Roll[]
}

export function DicePanel({ client, rolls }: Props) {
  const [expression, setExpression] = useState('1d20')
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<RollMode>('normal')
  const [privately, setPrivately] = useState(false)
  const [color, setColor] = useState(storedColor)

  useEffect(() => {
    try {
      localStorage.setItem(COLOR_KEY, color)
    } catch {
      // Not worth interrupting anyone over; the colour still applies this session.
    }
  }, [color])

  const submit = (value: string = expression) => {
    const trimmed = value.trim()
    if (!trimmed) return
    client.roll(trimmed, label.trim(), mode, privately ? 'gm' : 'public', color)
    setMode('normal')
  }

  return (
    <div className="panel dice-panel">
      <div className="dice-panel__quick">
        {QUICK_DICE.map((die) => (
          <button key={die} type="button" className="chip" onClick={() => submit(die)}>
            {die}
          </button>
        ))}
      </div>

      <form
        className="dice-panel__form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          className="input"
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          aria-label="Dice expression"
          placeholder="2d6+3, 4d6kh3, 1d20"
          spellCheck={false}
        />
        <input
          className="input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          aria-label="What the roll is for"
          placeholder="What for? (Stealth, Axe…)"
        />

        <div className="dice-panel__modes" role="group" aria-label="Roll mode">
          {(['disadvantage', 'normal', 'advantage'] as RollMode[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`chip${mode === option ? ' chip--on' : ''}`}
              onClick={() => setMode(option)}
            >
              {option === 'normal' ? 'Straight' : option === 'advantage' ? 'Advantage' : 'Disadvantage'}
            </button>
          ))}
        </div>

        <fieldset className="dice-colors">
          <legend>Your dice</legend>
          <div className="dice-colors__swatches">
            {DIE_COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`die-swatch${color === option.value ? ' die-swatch--on' : ''}`}
                style={{ background: option.value }}
                aria-label={option.name}
                aria-pressed={color === option.value}
                title={option.name}
                onClick={() => setColor(option.value)}
              />
            ))}
            <label className="die-swatch die-swatch--custom" title="Any colour you like">
              <input
                type="color"
                value={color}
                aria-label="A colour of your own"
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
          </div>
        </fieldset>

        {client.role === 'gm' ? (
          <label className="checkbox">
            <input type="checkbox" checked={privately} onChange={(event) => setPrivately(event.target.checked)} />
            Roll behind the screen
          </label>
        ) : null}

        <button type="submit" className="button button--primary">
          Roll
        </button>
      </form>

      <ol className="roll-log">
        {[...rolls].reverse().map((roll) => (
          <RollEntry key={roll.id} roll={roll} />
        ))}
        {rolls.length === 0 ? <li className="roll-log__empty">No dice yet.</li> : null}
      </ol>
    </div>
  )
}

function RollEntry({ roll }: { roll: Roll }) {
  const critical = criticalKind(roll.result)
  return (
    <li className={`roll-log__entry${roll.visibility === 'gm' ? ' roll-log__entry--private' : ''}`}>
      <div className="roll-log__head">
        {roll.color ? <span className="roll-log__dot" style={{ background: roll.color }} aria-hidden="true" /> : null}
        <strong>{roll.by}</strong>
        {roll.label ? <span className="roll-log__label">{roll.label}</span> : null}
        {roll.visibility === 'gm' ? <span className="roll-log__badge">private</span> : null}
        <time dateTime={new Date(roll.at).toISOString()}>
          {new Date(roll.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      <div className="roll-log__body">
        <span className="roll-log__detail">
          <RollDetail result={roll.result} />
        </span>
        <span className={`roll-log__total${critical ? ` roll-log__total--${critical}` : ''}`}>{roll.result.total}</span>
      </div>
    </li>
  )
}
