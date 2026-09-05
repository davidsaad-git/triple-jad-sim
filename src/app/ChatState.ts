import { Store } from './GameStore'

export type ChatKind = 'game' | 'combat' | 'system'

export interface ChatMessage {
  id: number
  kind: ChatKind
  text: string
  tick: number
}

export interface ChatSnapshot {
  messages: readonly ChatMessage[]
}

export const chatStore = new Store<ChatSnapshot>({ messages: [] })

let nextId = 1
const MAX_MESSAGES = 200

export function addChatMessage(kind: ChatKind, text: string, tick = 0): void {
  const messages = [...chatStore.get().messages, { id: nextId++, kind, text, tick }]
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES)
  chatStore.set({ messages })
}
