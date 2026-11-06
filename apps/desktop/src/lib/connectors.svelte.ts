import { api } from './api'
import { account } from './account.svelte'
import { message } from './i18n.svelte'
import { isRecord, keep, keepJson, stored, storedText } from './stored'

const STORAGE_KEY = 'nib:llm'
const CLIENT_KEY = 'nib:llm-client'

export type Client = 'claude' | 'chatgpt' | 'other'

interface Connected {
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

const POLL = 4000

class Connectors {
  clients = $state<Connected[]>([])
  token = $state<Token | null>(null)
  client = $state<Client>('claude')

  readOnly = $state(true)
  freshToken = $state<string | null>(null)

  busy = $state(false)
  error = $state<string | null>(null)

  restore() {
    const saved = stored(STORAGE_KEY)
    this.readOnly = !isRecord(saved) || saved.readOnly !== false

    const client = storedText(CLIENT_KEY)
    if (client === 'claude' || client === 'chatgpt' || client === 'other') this.client = client
  }

  choose(client: Client) {
    this.client = client
    keep(CLIENT_KEY, client)
  }

  async load() {
    if (!account.accountToken) {
      this.clients = []
      this.token = null
      return
    }

    try {
      const listed = await api.connector(account.accountToken)
      this.clients = listed.clients
      this.token = {
        exists: listed.exists,
        readOnly: listed.readOnly,
        lastUsedAt: listed.lastUsedAt,
      }
      if (listed.exists) this.readOnly = listed.readOnly
    } catch {
      // A failed refresh keeps what was last known.
    }
  }

  watch(): () => void {
    void this.load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.load()
    }, POLL)

    return () => clearInterval(timer)
  }

  async disconnect(id: string) {
    if (!account.accountToken) return

    this.clients = this.clients.filter((one) => one.id !== id)
    this.error = null

    try {
      await api.disconnectClient(account.accountToken, id)
    } catch (error) {
      this.error = message(error, 'could not reach the server')
    } finally {
      await this.load()
    }
  }

  async createToken() {
    if (!account.accountToken) return

    this.busy = true
    this.error = null

    try {
      const { token } = await api.issueConnector(account.accountToken, this.readOnly)
      this.freshToken = token
      keepJson(STORAGE_KEY, { readOnly: this.readOnly })
      await this.load()
    } catch (error) {
      this.error = message(error, 'could not create a token')
    } finally {
      this.busy = false
    }
  }

  async revokeToken() {
    if (!account.accountToken) return

    this.busy = true
    this.error = null

    try {
      await api.revokeConnector(account.accountToken)
      this.freshToken = null
      await this.load()
    } catch (error) {
      this.error = message(error, 'could not reach the server')
    } finally {
      this.busy = false
    }
  }

  setReadOnly(on: boolean) {
    this.readOnly = on
    keepJson(STORAGE_KEY, { readOnly: on })
  }
}

export const connectors = new Connectors()

account.forgetWithSession(() => {
  connectors.clients = []
  connectors.token = null
  connectors.freshToken = null
})
