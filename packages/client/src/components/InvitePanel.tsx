/**
 * Handing out seats at the table.
 *
 * Until this existed, anybody with the table code could type any name and own
 * that person's sheet — fine for five friends on a private network, not fine on
 * a tunnel that anyone who sees the URL can reach. An invite is a link the GM
 * sends once; the browser that follows it remembers it, and ownership follows
 * the invite rather than the word somebody typed.
 *
 * Links are shown rather than stored. The server derives them and keeps
 * nothing, so this panel is a place to make one and copy it, not a register of
 * who has one — which is also why revoking is all-or-nothing.
 */

import { useState } from 'react'
import type { RoomState } from '@vtt/core'
import { createInvite, inviteLink } from '../api.js'
import type { TableClient } from '../client.js'

interface Props {
  client: TableClient
  settings: RoomState['settings']
  gmKey: string
}

interface Issued {
  id: string
  link: string
  label: string
}

export function InvitePanel({ client, settings, gmKey }: Props) {
  const [issued, setIssued] = useState<Issued[]>([])
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const issue = async () => {
    setError(null)
    try {
      const invite = await createInvite(client.roomCode, gmKey)
      setIssued((current) => [
        {
          id: invite,
          link: inviteLink(client.roomCode, invite),
          label: label.trim() || `Player ${current.length + 1}`,
        },
        ...current,
      ])
      setLabel('')
    } catch {
      setError('The server would not issue an invite. Check the table is still open.')
    }
  }

  const copy = (entry: Issued) => {
    void navigator.clipboard?.writeText(entry.link)
    setCopied(entry.id)
    setTimeout(() => setCopied((current) => (current === entry.id ? null : current)), 1500)
  }

  return (
    <div className="panel panel--settings">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.requireInvite}
          onChange={(event) => client.send({ t: 'settings.update', patch: { requireInvite: event.target.checked } })}
        />
        Only people with an invite may join
      </label>
      <p className="hint">
        {settings.requireInvite
          ? 'Anyone without a link is turned away. Hand every player a link before your next session.'
          : 'Anyone with the table code can join under any name, and edit the sheet belonging to that name.'}
      </p>

      <div className="panel__actions">
        <input
          className="input"
          value={label}
          placeholder="Who is this for?"
          onChange={(event) => setLabel(event.target.value)}
        />
        <button type="button" className="button" onClick={() => void issue()}>
          New invite link
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <ul className="scene-list">
        {issued.map((entry) => (
          <li key={entry.id}>
            <button type="button" className="scene-list__name" onClick={() => copy(entry)}>
              {entry.label}
              <span className="hint">{copied === entry.id ? 'Copied' : 'Click to copy the link'}</span>
            </button>
          </li>
        ))}
        {issued.length === 0 ? <li className="roll-log__empty">No links made yet.</li> : null}
      </ul>

      <details className="fieldset">
        <summary>Revoke every link</summary>
        <p className="hint">
          Every link ever issued for this table stops working, including the ones people are using now. There is no way
          to revoke just one — you would have to keep a list of who has what, and that list would be one more thing to
          lose. Issue new links afterwards.
        </p>
        <button
          type="button"
          className="button button--danger button--small"
          onClick={() => {
            setIssued([])
            client.send({ t: 'settings.update', patch: { inviteEpoch: settings.inviteEpoch + 1 } })
          }}
        >
          Revoke all invites
        </button>
      </details>
    </div>
  )
}
