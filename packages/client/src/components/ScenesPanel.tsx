/**
 * The GM's map shelf.
 *
 * Scenes are staged privately and only the one put "on the table" is sent to
 * players, so next week's ambush can be prepared in the open during tonight's
 * session.
 */

import { useState } from 'react'
import type { Scene } from '@vtt/core'
import { newScene } from '@vtt/core'
import { revealedFraction } from '@vtt/core'
import { uploadAsset, uploadBlob } from '../api.js'
import type { LoadedPdf } from '../pdf.js'
import type { TableClient } from '../client.js'
import { newId } from '../ids.js'

interface Props {
  client: TableClient
  scenes: Scene[]
  activeSceneId: string | null
  editingSceneId: string | null
  onEditScene: (id: string | null) => void
  brushRadius: number
  onBrushRadius: (radius: number) => void
}

/** Drops the extension and tidies the separators a filename tends to carry. */
function cleanName(filename: string): string {
  return (
    filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Map'
  )
}

/**
 * Deliberately here rather than in pdf.ts: importing a *value* from that module
 * makes it a static dependency, which drags a megabyte of pdf.js into the
 * startup bundle for every table that never opens a PDF.
 */
function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

export function ScenesPanel({
  client,
  scenes,
  activeSceneId,
  editingSceneId,
  onEditScene,
  brushRadius,
  onBrushRadius,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A PDF waiting for someone to say which page holds the map. */
  const [pdf, setPdf] = useState<{ doc: LoadedPdf; name: string; page: number } | null>(null)
  const editing = scenes.find((scene) => scene.id === editingSceneId) ?? null

  const addScene = async (file: File) => {
    if (!client.gmKey) return
    setBusy(true)
    setError(null)
    try {
      if (isPdf(file)) {
        // Loaded on demand: pdf.js is about a megabyte, and a table that never
        // opens a PDF should not pay for it.
        const { loadPdf } = await import('../pdf.js')
        const doc = await loadPdf(file)
        if (doc.pageCount === 1) {
          await addPdfPage(doc, file.name, 1)
          doc.destroy()
        } else {
          setPdf({ doc, name: file.name, page: 1 })
        }
        return
      }

      const asset = await uploadAsset(client.roomCode, client.gmKey, file)
      const id = newId()
      client.send({ t: 'scene.create', scene: newScene(id, cleanName(file.name), asset.width, asset.height, asset.id) })
      onEditScene(id)
    } catch (cause) {
      console.error(cause)
      setError(cause instanceof Error ? cause.message : 'Could not add that map')
    } finally {
      setBusy(false)
    }
  }

  const addPdfPage = async (doc: LoadedPdf, name: string, page: number) => {
    if (!client.gmKey) return
    const rendered = await doc.renderPage(page, 3000)
    const asset = await uploadBlob(client.roomCode, client.gmKey, rendered.blob, rendered.width, rendered.height)
    const id = newId()
    const label = doc.pageCount > 1 ? `${cleanName(name)} — p${page}` : cleanName(name)
    client.send({ t: 'scene.create', scene: newScene(id, label, asset.width, asset.height, asset.id) })
    onEditScene(id)
  }

  const addBlankScene = () => {
    const id = newId()
    client.send({ t: 'scene.create', scene: newScene(id, 'Battlemat', 1400, 1000, null) })
    onEditScene(id)
  }

  return (
    <div className="panel">
      <div className="panel__actions">
        <label className={`button${busy ? ' button--busy' : ''}`}>
          {busy ? 'Reading…' : 'Add map'}
          <input
            type="file"
            accept="image/*,application/pdf,.pdf"
            hidden
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void addScene(file)
            }}
          />
        </label>
        <button type="button" className="button" onClick={addBlankScene}>
          Blank battlemat
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      {pdf ? (
        <div className="scene-editor">
          <p className="hint">
            <strong>{pdf.name}</strong> has {pdf.doc.pageCount} pages. Which one is the map?
          </p>
          <label className="field">
            <span>Page</span>
            <input
              className="input input--tiny"
              type="number"
              min={1}
              max={pdf.doc.pageCount}
              value={pdf.page}
              onChange={(event) =>
                setPdf({ ...pdf, page: Math.max(1, Math.min(pdf.doc.pageCount, Number(event.target.value) || 1)) })
              }
            />
          </label>
          <div className="panel__actions">
            <button
              type="button"
              className="button button--primary button--small"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setError(null)
                void addPdfPage(pdf.doc, pdf.name, pdf.page)
                  .then(() => {
                    pdf.doc.destroy()
                    setPdf(null)
                  })
                  .catch((cause) => {
                    console.error(cause)
                    setError(cause instanceof Error ? cause.message : 'Could not read that page')
                  })
                  .finally(() => setBusy(false))
              }}
            >
              {busy ? 'Rendering…' : 'Use this page'}
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                pdf.doc.destroy()
                setPdf(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <ul className="scene-list">
        {scenes.map((scene) => (
          <li key={scene.id} className={scene.id === editingSceneId ? 'scene-list__item--editing' : undefined}>
            <button type="button" className="scene-list__name" onClick={() => onEditScene(scene.id)}>
              {scene.name}
              {scene.id === activeSceneId ? <span className="badge">on the table</span> : null}
            </button>
            <button
              type="button"
              className="button button--small"
              disabled={scene.id === activeSceneId}
              onClick={() => client.send({ t: 'scene.setActive', id: scene.id })}
            >
              Show
            </button>
          </li>
        ))}
        {scenes.length === 0 ? <li className="roll-log__empty">No maps yet.</li> : null}
      </ul>

      {editing ? (
        <SceneEditor
          client={client}
          scene={editing}
          isActive={editing.id === activeSceneId}
          brushRadius={brushRadius}
          onBrushRadius={onBrushRadius}
          onDeleted={() => onEditScene(null)}
        />
      ) : null}
    </div>
  )
}

function SceneEditor({
  client,
  scene,
  isActive,
  brushRadius,
  onBrushRadius,
  onDeleted,
}: {
  client: TableClient
  scene: Scene
  isActive: boolean
  brushRadius: number
  onBrushRadius: (radius: number) => void
  onDeleted: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const explored = Math.round(revealedFraction(scene.fog.mask) * 100)

  const patchGrid = (patch: Partial<Scene['grid']>) => {
    client.send({ t: 'scene.update', id: scene.id, patch: { grid: { ...scene.grid, ...patch } } })
  }

  return (
    <div className="scene-editor">
      <h3>{scene.name}</h3>

      <div className="field">
        <label htmlFor="scene-name">Name</label>
        <input
          id="scene-name"
          className="input"
          value={scene.name}
          onChange={(event) => client.send({ t: 'scene.update', id: scene.id, patch: { name: event.target.value } })}
        />
      </div>

      <fieldset className="fieldset">
        <legend>Grid</legend>
        <div className="sheet__grid">
          <label className="field">
            <span>Square size (px)</span>
            <input
              className="input"
              type="number"
              min={8}
              value={scene.grid.size}
              onChange={(event) => patchGrid({ size: Math.max(8, Number(event.target.value)) })}
            />
          </label>
          <label className="field">
            <span>Nudge across</span>
            <input
              className="input"
              type="number"
              value={scene.grid.offsetX}
              onChange={(event) => patchGrid({ offsetX: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>Nudge down</span>
            <input
              className="input"
              type="number"
              value={scene.grid.offsetY}
              onChange={(event) => patchGrid({ offsetY: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>Units per square</span>
            <input
              className="input"
              type="number"
              value={scene.grid.unitsPerSquare}
              onChange={(event) => patchGrid({ unitsPerSquare: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="panel__actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={scene.grid.visible}
              onChange={(event) => patchGrid({ visible: event.target.checked })}
            />
            Show grid
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={scene.grid.snap}
              onChange={(event) => patchGrid({ snap: event.target.checked })}
            />
            Snap tokens (hold Alt to override)
          </label>
        </div>
      </fieldset>

      <fieldset className="fieldset">
        <legend>Fog of war</legend>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={scene.fog.enabled}
            onChange={(event) => client.send({ t: 'fog.enable', sceneId: scene.id, enabled: event.target.checked })}
          />
          Cover this map
        </label>
        <p className="hint">{explored}% uncovered</p>
        <div className="panel__actions">
          <button
            type="button"
            className="button button--small"
            onClick={() => client.send({ t: 'fog.setAll', sceneId: scene.id, revealed: true })}
          >
            Reveal all
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={() => client.send({ t: 'fog.setAll', sceneId: scene.id, revealed: false })}
          >
            Cover all
          </button>
        </div>
        <label className="field">
          <span>Brush size</span>
          <input
            type="range"
            min={20}
            max={400}
            step={10}
            value={brushRadius}
            onChange={(event) => onBrushRadius(Number(event.target.value))}
          />
        </label>
        <label className="field">
          <span>Fog detail (smaller is finer)</span>
          <select
            className="input"
            value={scene.fog.mask.cell}
            onChange={(event) => client.send({ t: 'fog.resize', sceneId: scene.id, cell: Number(event.target.value) })}
          >
            <option value={16}>Fine</option>
            <option value={32}>Normal</option>
            <option value={64}>Coarse</option>
          </select>
        </label>
      </fieldset>

      <div className="field field--wide">
        <label htmlFor="scene-notes">Staging notes (only you can see these)</label>
        <textarea
          id="scene-notes"
          className="input input--area"
          value={scene.gmNotes}
          onChange={(event) => client.send({ t: 'scene.update', id: scene.id, patch: { gmNotes: event.target.value } })}
        />
      </div>

      <div className="panel__actions">
        {confirmingDelete ? (
          <>
            <span className="hint">Delete “{scene.name}” and its tokens?</span>
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => {
                client.send({ t: 'scene.delete', id: scene.id })
                onDeleted()
              }}
            >
              Delete
            </button>
            <button type="button" className="button button--small" onClick={() => setConfirmingDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button--small"
            disabled={isActive}
            onClick={() => setConfirmingDelete(true)}
          >
            {isActive ? 'On the table' : 'Delete map'}
          </button>
        )}
      </div>
    </div>
  )
}
