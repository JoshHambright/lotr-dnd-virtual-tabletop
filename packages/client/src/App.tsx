/**
 * The table screen: map on the left, a stack of panels on the right.
 *
 * React subscribes to the client's *structural* channel, so the four times a
 * second a token moves do not re-render the sidebar. The map canvas has its
 * own animation frame and reads live state directly.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { TableClient } from './client.js'
import type { Joined } from './components/JoinScreen.js'
import { JoinScreen, gmKeyFor, rememberedName } from './components/JoinScreen.js'
import { MapView } from './components/MapView.js'
import type { Tool } from './components/MapView.js'
import { DicePanel } from './components/DicePanel.js'
import { ChatPanel } from './components/ChatPanel.js'
import { CharactersPanel } from './components/CharactersPanel.js'
import { ScenesPanel } from './components/ScenesPanel.js'
import { BestiaryPanel } from './components/BestiaryPanel.js'
import { TokenInspector } from './components/TokenInspector.js'
import { DiceTray } from './components/DiceTray.js'
import { GridCalibrator } from './components/GridCalibrator.js'
import type { Rect } from './view.js'
import { getImage, solveGrid } from './view.js'
import { assetUrl, roomExists } from './api.js'
import { packFor } from './pack.js'
import { detectGridInImage } from './gridDetect.js'
import type { DetectedGrid } from './gridDetect.js'
import { newToken } from '@vtt/core'
import { isValidRoomCode } from '@vtt/protocol'
import { newId } from './ids.js'

type Tab = 'dice' | 'sheets' | 'maps' | 'bestiary' | 'talk'

export function App() {
  const [joined, setJoined] = useState<Joined | null>(null)
  const initialCode = useMemo(() => new URLSearchParams(location.search).get('table')?.toUpperCase() ?? '', [])

  // A link with ?table=CODE joins straight away if this browser has been here
  // before, which is the common case on session night — and on every refresh.
  // Without this a reload lands on the join screen, where "open a table" is
  // one click away and quietly starts a fresh, empty one.
  const canRejoin = isValidRoomCode(initialCode) && rememberedName() !== ''
  const [rejoining, setRejoining] = useState(canRejoin)

  useEffect(() => {
    if (!canRejoin) return
    let cancelled = false
    void roomExists(initialCode).then((exists) => {
      if (cancelled) return
      if (exists) setJoined({ code: initialCode, name: rememberedName(), gmKey: gmKeyFor(initialCode) })
      setRejoining(false)
    })
    return () => {
      cancelled = true
    }
  }, [canRejoin, initialCode])

  if (rejoining) {
    return (
      <main className="join">
        <div className="join__card">
          <h1>Middle-earth Table</h1>
          <p className="join__blurb">Rejoining {initialCode}…</p>
        </div>
      </main>
    )
  }

  if (!joined) {
    return (
      <JoinScreen
        initialCode={initialCode}
        onJoin={(next) => {
          history.replaceState(null, '', `?table=${next.code}`)
          setJoined({ ...next, gmKey: next.gmKey ?? gmKeyFor(next.code) })
        }}
      />
    )
  }

  // Leaving on purpose forgets the table in the URL too, so a later refresh
  // does not walk straight back in.
  const leave = () => {
    history.replaceState(null, '', location.pathname)
    setJoined(null)
  }

  return <Table key={joined.code + joined.name} joined={joined} onLeave={leave} />
}

export function Table({
  joined,
  onLeave,
  client: injected,
}: {
  joined: Joined
  onLeave: () => void
  /** Supplied by the demo, which runs a server in the same tab. */
  client?: TableClient
}) {
  const client = useMemo(() => injected ?? new TableClient(joined.code, joined.name, joined.gmKey), [joined, injected])

  useEffect(() => {
    client.connect()
    return () => client.disconnect()
  }, [client])

  useSyncExternalStore(client.subscribeStructural, client.getStructuralVersion, client.getStructuralVersion)

  const [tab, setTab] = useState<Tab>('dice')
  const [tool, setTool] = useState<Tool>('select')
  const [brushRadius, setBrushRadius] = useState(120)
  const [previewAsPlayer, setPreviewAsPlayer] = useState(false)
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null)
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null)
  const [openCharacterId, setOpenCharacterId] = useState<string | null>(null)
  const [openStatBlockId, setOpenStatBlockId] = useState<string | null>(null)
  const [alignBox, setAlignBox] = useState<Rect | null>(null)
  const [alignAcross, setAlignAcross] = useState(1)
  const [alignDown, setAlignDown] = useState(1)
  const [detected, setDetected] = useState<DetectedGrid | null>(null)
  const [detecting, setDetecting] = useState<'idle' | 'working' | 'nothing'>('idle')

  const isGm = client.role === 'gm'
  const room = client.room
  const { pack, missing: missingPack } = packFor(room.settings.rulesetId)
  const scenes = Object.values(room.scenes)

  // The GM looks at whichever scene they are editing; players always see the
  // one on the table.
  const visibleScene = isGm
    ? ((editingSceneId ? room.scenes[editingSceneId] : null) ??
      (room.activeSceneId ? room.scenes[room.activeSceneId] : null) ??
      null)
    : room.activeSceneId
      ? (room.scenes[room.activeSceneId] ?? null)
      : null

  const selectedToken = selectedTokenId ? room.tokens[selectedTokenId] : undefined
  const latestRoll = room.rolls.length ? room.rolls[room.rolls.length - 1]! : null

  const addBlankToken = useCallback(() => {
    if (!visibleScene) return
    client.send({
      t: 'token.create',
      token: newToken(newId(), visibleScene.id, visibleScene.width / 2, visibleScene.height / 2, {
        label: 'Token',
      }),
    })
  }, [client, visibleScene])

  useEffect(() => {
    if (!client.lastError) return
    const timer = setTimeout(() => client.clearError(), 4000)
    return () => clearTimeout(timer)
  }, [client, client.lastError])

  const canDrawFog = isGm && Boolean(visibleScene)

  const alignSolution = alignBox ? solveGrid(alignBox, alignAcross, alignDown) : null
  // A box the GM drew is a deliberate answer, so it wins over a detected one.
  const candidate = alignSolution ?? detected
  const gridPreview = candidate
    ? { size: candidate.size, offsetX: candidate.offsetX, offsetY: candidate.offsetY }
    : null

  const leaveAlignment = () => {
    setAlignBox(null)
    setAlignAcross(1)
    setAlignDown(1)
    setDetected(null)
    setDetecting('idle')
  }

  const findGrid = () => {
    if (!visibleScene?.assetId) return
    const image = getImage(assetUrl(client.roomCode, visibleScene.assetId, client.gmKey))
    if (!image) return
    setDetecting('working')
    // A frame first, so the button shows it is working before the main thread
    // goes away for a moment.
    requestAnimationFrame(() => {
      const found = detectGridInImage(image, visibleScene.width, visibleScene.height)
      setAlignBox(null)
      setDetected(found)
      setDetecting(found ? 'idle' : 'nothing')
    })
  }

  const applyGrid = () => {
    if (!visibleScene || !candidate) return
    client.send({
      t: 'scene.update',
      id: visibleScene.id,
      patch: {
        grid: {
          ...visibleScene.grid,
          size: round(candidate.size),
          offsetX: round(candidate.offsetX),
          offsetY: round(candidate.offsetY),
          visible: true,
        },
      },
    })
    leaveAlignment()
    setTool('select')
  }

  return (
    <div className="table">
      <header className="table__bar">
        <div className="table__identity">
          <strong>{room.settings.name}</strong>
          <button
            type="button"
            className="code"
            title="Copy the invite link"
            onClick={() => void navigator.clipboard?.writeText(`${location.origin}/?table=${client.roomCode}`)}
          >
            {client.roomCode}
          </button>
          <span className={`status status--${client.status}`}>{statusLabel(client.status)}</span>
        </div>

        <div className="table__tools" role="group" aria-label="Map tools">
          <button
            type="button"
            className={`chip${tool === 'select' ? ' chip--on' : ''}`}
            onClick={() => setTool('select')}
          >
            Move
          </button>
          <button
            type="button"
            className={`chip${tool === 'measure' ? ' chip--on' : ''}`}
            onClick={() => setTool('measure')}
          >
            Measure
          </button>
          {canDrawFog ? (
            <>
              <button
                type="button"
                className={`chip${tool === 'reveal' ? ' chip--on' : ''}`}
                onClick={() => setTool('reveal')}
              >
                Reveal
              </button>
              <button
                type="button"
                className={`chip${tool === 'conceal' ? ' chip--on' : ''}`}
                onClick={() => setTool('conceal')}
              >
                Cover
              </button>
              <button
                type="button"
                className={`chip${tool === 'align' ? ' chip--on' : ''}`}
                title="Drag a box across squares you can see on the map"
                onClick={() => {
                  leaveAlignment()
                  setTool(tool === 'align' ? 'select' : 'align')
                }}
              >
                Align grid
              </button>
            </>
          ) : null}
          {isGm ? (
            <>
              <button type="button" className="chip" onClick={addBlankToken} disabled={!visibleScene}>
                Add token
              </button>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={previewAsPlayer}
                  onChange={(event) => setPreviewAsPlayer(event.target.checked)}
                />
                See it as players do
              </label>
            </>
          ) : null}
        </div>

        <div className="table__people">
          {client.presence.map((person) => (
            <span key={person.connectionId} className={`person${person.role === 'gm' ? ' person--gm' : ''}`}>
              {person.name}
            </span>
          ))}
          <button type="button" className="button button--small" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      {client.demotedFromGm ? (
        <div className="notice">
          This browser’s GM key was not accepted for table <strong>{client.roomCode}</strong>, so you have joined as a
          player. If you are the GM, reopen the table or paste the key you were given.
        </div>
      ) : null}

      {missingPack ? (
        <div className="notice">
          This table plays <strong>{missingPack}</strong>, which this copy of the app does not have. Sheets are being
          drawn with <strong>{pack.name}</strong> instead, so some fields may be missing. Nothing already saved has been
          changed.
        </div>
      ) : null}

      {isGm && editingSceneId && editingSceneId !== room.activeSceneId ? (
        <div className="notice">
          You are staging <strong>{room.scenes[editingSceneId]?.name}</strong>. The table is still looking at{' '}
          <strong>{room.activeSceneId ? room.scenes[room.activeSceneId]?.name : 'nothing'}</strong>.
          <button
            type="button"
            className="button button--small"
            onClick={() => client.send({ t: 'scene.setActive', id: editingSceneId })}
          >
            Put it on the table
          </button>
        </div>
      ) : null}

      <div className="table__body">
        <div className="table__map">
          <MapView
            client={client}
            scene={visibleScene}
            tool={tool}
            brushRadius={brushRadius}
            previewAsPlayer={previewAsPlayer}
            selectedTokenId={selectedTokenId}
            onSelectToken={setSelectedTokenId}
            alignBox={alignBox}
            onAlignBox={setAlignBox}
            gridPreview={gridPreview}
          />

          {tool === 'align' && visibleScene ? (
            candidate ? (
              <GridCalibrator
                measured={alignSolution !== null}
                confidence={detected && !alignSolution ? detected.confidence : null}
                across={alignAcross}
                down={alignDown}
                solution={candidate}
                unitsPerSquare={visibleScene.grid.unitsPerSquare}
                unitLabel={visibleScene.grid.unitLabel}
                onAcross={setAlignAcross}
                onDown={setAlignDown}
                onUnits={(unitsPerSquare) =>
                  client.send({
                    t: 'scene.update',
                    id: visibleScene.id,
                    patch: { grid: { ...visibleScene.grid, unitsPerSquare } },
                  })
                }
                canDetect={Boolean(visibleScene.assetId)}
                detecting={detecting}
                onDetect={findGrid}
                onApply={applyGrid}
                onCancel={() => {
                  leaveAlignment()
                  setTool('select')
                }}
              />
            ) : (
              <div className="calibrator">
                <p className="calibrator__lead">
                  Drag a box across squares you can see on the map — one is enough, three or four is more accurate.
                </p>
                {visibleScene.assetId ? (
                  <>
                    <p className="calibrator__hint">Or let it read the lines off the map itself.</p>
                    <div className="calibrator__actions">
                      <button
                        type="button"
                        className="button button--small"
                        disabled={detecting === 'working'}
                        onClick={findGrid}
                      >
                        {detecting === 'working' ? 'Looking…' : 'Find the grid'}
                      </button>
                    </div>
                    {detecting === 'nothing' ? (
                      <p className="calibrator__warning">No grid found on this map. Drag a box instead.</p>
                    ) : null}
                  </>
                ) : null}
              </div>
            )
          ) : null}

          <DiceTray roll={latestRoll} nonce={client.rollCount} />
          {client.lastError ? <div className="toast">{client.lastError}</div> : null}
        </div>

        <aside className="table__side">
          <nav className="tabs" role="tablist">
            {(['dice', 'sheets', 'maps', 'bestiary', 'talk'] as Tab[])
              .filter((name) => isGm || (name !== 'maps' && name !== 'bestiary'))
              .map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  className={`chip${tab === name ? ' chip--on' : ''}`}
                  onClick={() => setTab(name)}
                >
                  {tabLabel(name)}
                </button>
              ))}
          </nav>

          <div className="table__panels">
            {selectedToken && visibleScene ? (
              <TokenInspector
                client={client}
                token={selectedToken}
                scene={visibleScene}
                statBlock={selectedToken.statBlockId ? (room.bestiary[selectedToken.statBlockId] ?? null) : null}
                character={selectedToken.characterId ? (room.characters[selectedToken.characterId] ?? null) : null}
                onOpenStatBlock={(id) => {
                  setOpenStatBlockId(id)
                  setTab('bestiary')
                }}
              />
            ) : null}

            {tab === 'dice' ? <DicePanel client={client} rolls={room.rolls} /> : null}
            {tab === 'talk' ? <ChatPanel client={client} messages={room.chat} /> : null}
            {tab === 'sheets' ? (
              <CharactersPanel
                client={client}
                pack={pack}
                characters={Object.values(room.characters)}
                scene={visibleScene}
                openId={openCharacterId}
                onOpen={setOpenCharacterId}
              />
            ) : null}
            {tab === 'maps' && isGm ? (
              <ScenesPanel
                client={client}
                scenes={scenes}
                activeSceneId={room.activeSceneId}
                editingSceneId={editingSceneId}
                onEditScene={setEditingSceneId}
                brushRadius={brushRadius}
                onBrushRadius={setBrushRadius}
              />
            ) : null}
            {tab === 'bestiary' && isGm ? (
              <BestiaryPanel
                client={client}
                pack={pack}
                bestiary={Object.values(room.bestiary)}
                encounters={Object.values(room.encounters)}
                scene={visibleScene}
                openId={openStatBlockId}
                onOpen={setOpenStatBlockId}
              />
            ) : null}
          </div>

          {isGm ? (
            <div className="panel panel--settings">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={room.settings.playersCanMoveAnyToken}
                  onChange={(event) =>
                    client.send({ t: 'settings.update', patch: { playersCanMoveAnyToken: event.target.checked } })
                  }
                />
                Players can move any token
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={room.settings.playersCanCreateTokens}
                  onChange={(event) =>
                    client.send({ t: 'settings.update', patch: { playersCanCreateTokens: event.target.checked } })
                  }
                />
                Players can add and remove tokens
              </label>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

/** Two decimals is finer than any map is drawn, and keeps the panel readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

function statusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'connected'
    case 'reconnecting':
      return 'reconnecting…'
    case 'closed':
      return 'disconnected'
    default:
      return 'connecting…'
  }
}

function tabLabel(tab: Tab): string {
  switch (tab) {
    case 'dice':
      return 'Dice'
    case 'sheets':
      return 'Sheets'
    case 'maps':
      return 'Maps'
    case 'bestiary':
      return 'Bestiary'
    case 'talk':
      return 'Talk'
  }
}
