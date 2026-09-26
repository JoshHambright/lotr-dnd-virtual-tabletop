import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Role } from '@vtt/core'
import { Table } from '../App.js'
import { TableClient } from '../client.js'
import { LoopbackTransport } from './loopback.js'
import { seedDemoRoom } from './seed.js'
import '../styles.css'
import './demo.css'

/**
 * The demo: the real interface, the real rules engine, a server running in
 * this tab instead of across a network.
 *
 * The seat switch is the thing worth trying. It is not a UI toggle — flipping
 * to a player rebuilds what the browser has been *sent*, so the staged map,
 * the hidden ambusher and the GM's notes are not hidden from you, they are
 * gone.
 */
function Demo() {
  const [role, setRole] = useState<Role>('gm')

  const { client, transport } = useMemo(() => {
    const transport = new LoopbackTransport(seedDemoRoom())
    const client = new TableClient('DEMO', 'You', null, null, transport)
    client.connect()
    return { client, transport }
  }, [])

  const reseat = (next: Role) => {
    setRole(next)
    transport.setRole(next, next === 'gm' ? 'You (GM)' : 'You (player)')
  }

  return (
    <>
      <div className="demo-bar">
        <div className="demo-bar__what">
          <strong>Demo</strong>
          <span>
            Everything works except other people — the server is running in this tab, so nothing you do here is shared.
          </span>
        </div>

        <div className="demo-bar__seats" role="group" aria-label="Which seat you are in">
          <button type="button" className={`chip${role === 'gm' ? ' chip--on' : ''}`} onClick={() => reseat('gm')}>
            Sit in the GM’s chair
          </button>
          <button
            type="button"
            className={`chip${role === 'player' ? ' chip--on' : ''}`}
            onClick={() => reseat('player')}
          >
            Sit as a player
          </button>
        </div>
      </div>

      <div className="demo-hint">
        {role === 'gm' ? (
          <>
            <strong>Try:</strong> the <em>Maps</em> tab has a second map staged that the table cannot see ·{' '}
            <em>Bestiary</em> holds stat blocks players never receive · pick <em>Reveal</em> and brush the fog open ·
            tick <em>See it as players do</em> · then switch seats and watch it all disappear.
          </>
        ) : (
          <>
            <strong>You are a player now.</strong> No Maps tab, no Bestiary, one map, and Bill Ferny is not on it. That
            is not the interface hiding things — the browser was never sent them. Roll some dice; the log is the same
            one the GM sees.
          </>
        )}
      </div>

      <div className="demo-app">
        <Table
          joined={{ code: 'DEMO', name: 'You', gmKey: null, invite: null }}
          onLeave={() => reseat('gm')}
          client={client}
        />
      </div>
    </>
  )
}

const root = document.getElementById('root')
if (root)
  createRoot(root).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  )
