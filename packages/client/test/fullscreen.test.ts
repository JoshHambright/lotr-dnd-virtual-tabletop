/**
 * Full screen, with the browser standing in.
 *
 * Every part of this API can be missing — Safari on an iPhone has no element
 * fullscreen at all, an iPad only gained it in 16.4, and an iframe without the
 * right permissions policy has the method and refuses every call. So the tests
 * that matter are the ones where something is absent or says no.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFullscreen, isSupported, toggleFullscreen, watchFullscreen } from '../src/fullscreen.js'

interface FakeDocument {
  /** Explicitly `| undefined`, because a browser that has never heard of this
   *  is one of the cases worth testing. */
  fullscreenEnabled?: boolean | undefined
  fullscreenElement: Element | null
  documentElement: { requestFullscreen?: (options?: unknown) => Promise<void> }
  exitFullscreen?: () => Promise<void>
  addEventListener: (type: string, handler: () => void) => void
  removeEventListener: (type: string, handler: () => void) => void
}

const listeners = new Map<string, Set<() => void>>()

function fakeDocument(overrides: Partial<FakeDocument> = {}): FakeDocument {
  return {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: { requestFullscreen: () => Promise.resolve() },
    exitFullscreen: () => Promise.resolve(),
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(handler)
    },
    removeEventListener: (type, handler) => listeners.get(type)?.delete(handler),
    ...overrides,
  }
}

/** Stands the fake in for the real document for the duration of one test. */
function install(document: FakeDocument): void {
  vi.stubGlobal('document', document)
}

function fire(type: string): void {
  for (const handler of listeners.get(type) ?? []) handler()
}

afterEach(() => {
  vi.unstubAllGlobals()
  listeners.clear()
})

describe('isSupported', () => {
  it('is true when the browser will full-screen an element', () => {
    install(fakeDocument())
    expect(isSupported()).toBe(true)
  })

  it('is false when the permissions policy withholds it', () => {
    // An iframe without allow="fullscreen" *has* the method and is refused
    // every time, so the method existing is not the question to ask.
    install(fakeDocument({ fullscreenEnabled: false }))
    expect(isSupported()).toBe(false)
  })

  it('is false on a browser that has no notion of it', () => {
    install(fakeDocument({ fullscreenEnabled: undefined }))
    expect(isSupported()).toBe(false)
  })
})

describe('toggleFullscreen', () => {
  it('asks to enter when it is not full screen, and hides the navigation UI', async () => {
    const request = vi.fn(() => Promise.resolve())
    const document = fakeDocument({ documentElement: { requestFullscreen: request } })
    install(document)

    // The fake browser grants it.
    request.mockImplementation(() => {
      document.fullscreenElement = {} as Element
      return Promise.resolve()
    })

    await expect(toggleFullscreen(document.documentElement as unknown as Element)).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' })
  })

  it('asks to leave when it is already full screen', async () => {
    const exit = vi.fn(() => Promise.resolve())
    const document = fakeDocument({ fullscreenElement: {} as Element, exitFullscreen: exit })
    install(document)

    exit.mockImplementation(() => {
      document.fullscreenElement = null
      return Promise.resolve()
    })

    await expect(toggleFullscreen()).resolves.toBe(false)
    expect(exit).toHaveBeenCalled()
  })

  it('reports where it ended up when the browser refuses', async () => {
    // A refusal is not worth showing anybody. The button simply did not work,
    // which is what the returned value says.
    install(fakeDocument({ documentElement: { requestFullscreen: () => Promise.reject(new Error('not allowed')) } }))
    await expect(toggleFullscreen()).resolves.toBe(false)
  })

  it('does not throw when the method is missing entirely', async () => {
    install(fakeDocument({ documentElement: {} }))
    await expect(toggleFullscreen()).resolves.toBe(false)
  })
})

describe('watchFullscreen', () => {
  it('reports a change the button did not cause', () => {
    // Escape and F11 both leave full screen without going near the button.
    const document = fakeDocument()
    install(document)

    const seen: boolean[] = []
    watchFullscreen((value) => seen.push(value))

    document.fullscreenElement = {} as Element
    fire('fullscreenchange')
    document.fullscreenElement = null
    fire('fullscreenchange')

    expect(seen).toEqual([true, false])
  })

  it('stops listening when told to', () => {
    const document = fakeDocument()
    install(document)

    const seen: boolean[] = []
    const stop = watchFullscreen((value) => seen.push(value))
    stop()

    document.fullscreenElement = {} as Element
    fire('fullscreenchange')
    expect(seen).toEqual([])
  })
})

describe('isFullscreen', () => {
  it('reads the document rather than remembering anything', () => {
    const document = fakeDocument()
    install(document)
    expect(isFullscreen()).toBe(false)
    document.fullscreenElement = {} as Element
    expect(isFullscreen()).toBe(true)
  })
})
