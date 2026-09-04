/** What is connected to the account through the LLM connector: the clients
 *  that signed in through OAuth, and the one pasted token, if there is one. */

import { api } from './api'
import { account } from './account.svelte'
import { message } from './i18n.svelte'

const STORAGE_KEY = 'nib:llm'
const CLIENT_KEY = 'nib:llm-client'

/** The clients the setup steps are written for. */
export type Client = 'claude' | 'chatgpt' | 'other'

export interface Connected {
  id: string
  name: string
  readOnly: boolean
  createdAt: number
  lastUsedAt: number | null
}

interface Token {
  exists: boolean
  readOnly: boolean
  lastUsedAt: number | null
}

/** How often the list is re-read while it is on screen. Signing in happens
 *  in a browser somewhere else, and the pane should notice without being
 *  asked: seeing the client appear is how a person knows they are done. */
const POLL = 4000

class Connectors {
  clients = $state<Connected[]>([])
  token = $state<Token | null>(null)
  /** Which client's steps are showing. Remembered, since people have one. */
  client = $state<Client>('claude')

  /** A pasted token is read-only until widened. */
  readOnly = $state(true)
  /** Shown once, straight after minting. It is never retrievable again. */
  freshToken = $state<string | null>(null)

  busy = $state(false)
  error = $state<string | null>(null)

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      this.readOnly = saved.readOnly ?? true
    } catch {
      // Defaults are the safe ones.
    }

    const client = localStorage.getItem(CLIENT_KEY)
    if (client === 'claude' || client === 'chatgpt' || client === 'other') this.client = client
  }

  choose(client: Client) {
    this.client = client
    localStorage.setItem(CLIENT_KEY, client)
  }

  async load() {
    if (!account.token) {
      this.clients = []
      this.token = null
      return
    }

    try {
      const listed = await api.connector(account.token)
      // A server from before OAuth lists no clients at all.
      this.clients = listed.clients ?? []
      this.token = { exists: listed.exists, readOnly: listed.readOnly, lastUsedAt: listed.lastUsedAt }
      if (listed.exists) this.readOnly = listed.readOnly
    } catch {
      // A failed refresh keeps what was last known.
    }
  }

  /** Keeps the list fresh while something shows it; returns the way to stop. */
  watch(): () => void {
    void this.load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.load()
    }, POLL)

    return () => clearInterval(timer)
  }

  async disconnect(id: string) {
    if (!account.token) return

    // Gone from the list at once; the server is told next.
    this.clients = this.clients.filter((one) => one.id !== id)
    try {
      await api.disconnectClient(account.token, id)
    } finally {
      await this.load()
    }
  }

  /** Mints a pasted token and shows it once. Any previous one stops working. */
  async createToken() {
    if (!account.token) return

    this.busy = true
    this.error = null

    try {
      const { token } = await api.issueConnector(account.token, this.readOnly)
      this.freshToken = token
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ readOnly: this.readOnly }))
      await this.load()
    } catch (error) {
      this.error = message(error, 'could not create a token')
    } finally {
      this.busy = false
    }
  }

  async revokeToken() {
    if (!account.token) return

    this.busy = true
    try {
      await api.revokeConnector(account.token)
      this.freshToken = null
      await this.load()
    } finally {
      this.busy = false
    }
  }

  setReadOnly(on: boolean) {
    this.readOnly = on
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ readOnly: on }))
  }
}

export const connectors = new Connectors()
