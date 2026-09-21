/**
 * Opening or joining a table.
 *
 * A GM opens a table and gets back two things: a code to read out over Zoom,
 * and a GM key that is the only credential in the system. The key is kept in
 * this browser's local storage so reopening the tab does not demote the GM to
 * a player mid-session.
 */

import { useState } from 'react'
import { createRoom, roomExists } from '../api.js'
import { isValidRoomCode, normalizeRoomCode } from '@vtt/protocol'

export interface Joined {
  code: string
  name: string
  gmKey: string | null
}

const NAME_KEY = 'met.name'

export function gmKeyFor(code: string): string | null {
  try {
    return localStorage.getItem(`met.gm.${code}`)
  } catch {
    return null
  }
}

export function rememberGmKey(code: string, key: string): void {
  try {
    localStorage.setItem(`met.gm.${code}`, key)
  } catch {
    // Private browsing: the GM will need the key from the link instead.
  }
}

export function JoinScreen({ initialCode, onJoin }: { initialCode: string; onJoin: (joined: Joined) => void }) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [code, setCode] = useState(initialCode)
  const [tableName, setTableName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remember = (value: string) => {
    try {
      localStorage.setItem(NAME_KEY, value)
    } catch {
      // Not worth interrupting anyone over.
    }
  }

  const open = async () => {
    if (!name.trim()) return setError('Put your name in first')
    setBusy(true)
    setError(null)
    try {
      const room = await createRoom(tableName.trim() || 'A new table')
      rememberGmKey(room.code, room.gmKey)
      remember(name.trim())
      onJoin({ code: room.code, name: name.trim(), gmKey: room.gmKey })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open a table')
      setBusy(false)
    }
  }

  const join = async () => {
    const normalized = normalizeRoomCode(code)
    if (!name.trim()) return setError('Put your name in first')
    if (!isValidRoomCode(normalized)) return setError('That does not look like a table code')

    setBusy(true)
    setError(null)
    if (!(await roomExists(normalized))) {
      setError('No table with that code. Check it with your GM.')
      setBusy(false)
      return
    }
    remember(name.trim())
    onJoin({ code: normalized, name: name.trim(), gmKey: gmKeyFor(normalized) })
  }

  return (
    <main className="join">
      <div className="join__card">
        <h1>Middle-earth Table</h1>
        <p className="join__blurb">A shared map, honest dice and everyone’s sheets — for a game played over a call.</p>

        <label className="field">
          <span>Your name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="How the table knows you"
            autoComplete="nickname"
          />
        </label>

        <section className="join__section">
          <h2>Join a table</h2>
          <form
            className="join__row"
            onSubmit={(event) => {
              event.preventDefault()
              void join()
            }}
          >
            <input
              className="input input--code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="TABLE CODE"
              spellCheck={false}
              aria-label="Table code"
            />
            <button type="submit" className="button button--primary" disabled={busy}>
              Join
            </button>
          </form>
        </section>

        <section className="join__section">
          <h2>Or open one as GM</h2>
          <form
            className="join__row"
            onSubmit={(event) => {
              event.preventDefault()
              void open()
            }}
          >
            <input
              className="input"
              value={tableName}
              onChange={(event) => setTableName(event.target.value)}
              placeholder="Name of the campaign"
              aria-label="Campaign name"
            />
            <button type="submit" className="button" disabled={busy}>
              Open table
            </button>
          </form>
          <p className="hint">
            You will get a code to read out, and a GM key kept in this browser. Keep the key to yourself — it is what
            makes you the GM.
          </p>
        </section>

        {error ? <p className="error">{error}</p> : null}
      </div>
    </main>
  )
}
