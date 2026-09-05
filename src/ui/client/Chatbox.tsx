import { useEffect, useRef } from 'react'
import { useStore } from '../../app/GameStore'
import { chatStore } from '../../app/ChatState'
import './Chatbox.css'

export function Chatbox() {
  const messages = useStore(chatStore, (s) => s.messages)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])
  return (
    <div className="chatbox">
      <div className="chatbox__messages" ref={ref}>
        {messages.map((m) => (
          <div key={m.id} className={`chat-line chat-line--${m.kind}`}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="chatbox__input">
        <span className="chatbox__prompt">Player:</span> <span className="chatbox__cursor">*</span>
      </div>
      <div className="chatbox__tabs">
        {['All', 'Game', 'Public', 'Private', 'Channel', 'Clan', 'Trade'].map((t) => (
          <span key={t} className={`chatbox__tab${t === 'All' ? ' chatbox__tab--active' : ''}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}
