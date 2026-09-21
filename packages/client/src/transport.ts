/**
 * How the client reaches a table.
 *
 * Extracted so the same client code can talk to a real websocket, to an
 * in-process server (the demo, and the multi-client tests in workstream F), or
 * to whatever a future adapter provides. The client does not care; it sends
 * strings and receives strings.
 */

export interface TransportHandlers {
  onOpen(): void
  onMessage(raw: string): void
  onClose(): void
}

export interface Transport {
  open(handlers: TransportHandlers): void
  send(raw: string): void
  close(): void
}

/** The real thing: a websocket to a table server. */
export class WebSocketTransport implements Transport {
  #socket: WebSocket | null = null

  constructor(private readonly url: string) {}

  open(handlers: TransportHandlers): void {
    const socket = new WebSocket(this.url)
    this.#socket = socket
    socket.addEventListener('open', () => handlers.onOpen())
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') handlers.onMessage(event.data)
    })
    socket.addEventListener('close', () => handlers.onClose())
    // An error is always followed by a close, which is where reconnection lives.
    socket.addEventListener('error', () => {})
  }

  send(raw: string): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(raw)
  }

  close(): void {
    this.#socket?.close()
    this.#socket = null
  }
}
