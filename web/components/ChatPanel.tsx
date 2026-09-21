/** Table talk. Zoom carries the conversation; this carries what needs writing down. */

import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../shared/state.js'
import type { TableClient } from '../client.js'

export function ChatPanel({ client, messages }: { client: TableClient; messages: ChatMessage[] }) {
  const [text, setText] = useState('')
  const [privately, setPrivately] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  return (
    <div className="panel chat-panel">
      <ol className="chat-log">
        {messages.map((message) => (
          <li key={message.id} className={message.visibility === 'gm' ? 'chat-log__entry--private' : undefined}>
            <strong>{message.by}</strong>
            {message.visibility === 'gm' ? <span className="roll-log__badge">private</span> : null}
            <span>{message.text}</span>
          </li>
        ))}
        {messages.length === 0 ? <li className="roll-log__empty">Nothing said yet.</li> : null}
        <div ref={endRef} />
      </ol>

      <form
        className="chat-panel__form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!text.trim()) return
          client.chat(text, privately ? 'gm' : 'public')
          setText('')
        }}
      >
        <input
          className="input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Say something"
          aria-label="Message"
        />
        {client.role === 'gm' ? (
          <label className="checkbox">
            <input type="checkbox" checked={privately} onChange={(event) => setPrivately(event.target.checked)} />
            GM only
          </label>
        ) : null}
        <button type="submit" className="button">
          Send
        </button>
      </form>
    </div>
  )
}
