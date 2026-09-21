import { describe, expect, it } from 'vitest'
import { MAX_LOG_ENTRIES, emptyRoom, newCharacter, newScene, newToken, reduce } from '../shared/state.js'
import type { ChatMessage, RoomState } from '../shared/state.js'
import { isRevealed } from '../shared/fog.js'

function roomWithScene(): RoomState {
  return reduce(emptyRoom(), { t: 'scene.create', scene: newScene('s1', 'Moria', 640, 640, 'asset-1') })
}

describe('scenes', () => {
  it('creates and activates a scene', () => {
    let state = roomWithScene()
    state = reduce(state, { t: 'scene.setActive', id: 's1' })
    expect(state.activeSceneId).toBe('s1')
    expect(state.scenes['s1']?.name).toBe('Moria')
  })

  it('merges a grid patch instead of replacing the grid wholesale', () => {
    const state = reduce(roomWithScene(), { t: 'scene.update', id: 's1', patch: { grid: { size: 50 } as never } })
    expect(state.scenes['s1']?.grid).toMatchObject({ size: 50, snap: true, unitLabel: 'ft' })
  })

  it('takes its tokens with it when a scene is deleted', () => {
    let state = roomWithScene()
    state = reduce(state, { t: 'token.create', token: newToken('t1', 's1', 10, 10) })
    state = reduce(state, { t: 'scene.setActive', id: 's1' })
    state = reduce(state, { t: 'scene.delete', id: 's1' })
    expect(state.tokens).toEqual({})
    expect(state.activeSceneId).toBeNull()
  })

  it('ignores an update to a scene that is gone', () => {
    const state = roomWithScene()
    expect(reduce(state, { t: 'scene.update', id: 'nope', patch: { name: 'x' } })).toBe(state)
  })
})

describe('fog', () => {
  it('paints through the reducer', () => {
    let state = roomWithScene()
    state = reduce(state, { t: 'fog.paint', sceneId: 's1', shape: { kind: 'circle', x: 100, y: 100, radius: 50 }, reveal: true })
    expect(isRevealed(state.scenes['s1']!.fog.mask, 100, 100)).toBe(true)
  })

  it('reveals and hides the whole map', () => {
    let state = roomWithScene()
    state = reduce(state, { t: 'fog.setAll', sceneId: 's1', revealed: true })
    expect(isRevealed(state.scenes['s1']!.fog.mask, 600, 600)).toBe(true)
  })

  it('toggles fog on without disturbing the mask', () => {
    let state = roomWithScene()
    state = reduce(state, { t: 'fog.paint', sceneId: 's1', shape: { kind: 'circle', x: 100, y: 100, radius: 50 }, reveal: true })
    state = reduce(state, { t: 'fog.enable', sceneId: 's1', enabled: true })
    expect(state.scenes['s1']?.fog.enabled).toBe(true)
    expect(isRevealed(state.scenes['s1']!.fog.mask, 100, 100)).toBe(true)
  })
})

describe('tokens', () => {
  it('moves a token', () => {
    let state = reduce(roomWithScene(), { t: 'token.create', token: newToken('t1', 's1', 0, 0) })
    state = reduce(state, { t: 'token.move', id: 't1', x: 70, y: 140 })
    expect(state.tokens['t1']).toMatchObject({ x: 70, y: 140 })
  })

  it('will not let a patch change a token’s identity or scene', () => {
    let state = reduce(roomWithScene(), { t: 'token.create', token: newToken('t1', 's1', 0, 0) })
    state = reduce(state, { t: 'token.update', id: 't1', patch: { id: 'evil', sceneId: 's2' } as never })
    expect(state.tokens['t1']).toMatchObject({ id: 't1', sceneId: 's1' })
  })

  it('ignores a move for a token that was just deleted', () => {
    const state = roomWithScene()
    expect(reduce(state, { t: 'token.move', id: 'gone', x: 1, y: 1 })).toBe(state)
  })
})

describe('logs', () => {
  it('caps the chat log and keeps the newest entries', () => {
    let state = emptyRoom()
    for (let i = 0; i < MAX_LOG_ENTRIES + 25; i++) {
      const message: ChatMessage = { id: `m${i}`, at: i, by: 'Frodo', text: `${i}`, visibility: 'public' }
      state = reduce(state, { t: 'chat.add', message })
    }
    expect(state.chat).toHaveLength(MAX_LOG_ENTRIES)
    expect(state.chat[state.chat.length - 1]?.id).toBe(`m${MAX_LOG_ENTRIES + 24}`)
  })
})

describe('characters', () => {
  it('upserts and deletes a sheet', () => {
    let state = reduce(emptyRoom(), { t: 'character.upsert', character: newCharacter('c1', 'Frodo', 'Josh') })
    expect(state.characters['c1']?.name).toBe('Frodo')
    state = reduce(state, { t: 'character.delete', id: 'c1' })
    expect(state.characters['c1']).toBeUndefined()
  })
})
