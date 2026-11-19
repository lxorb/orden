import { api } from './client'
import { account } from './account.svelte'
import { message } from '../../ui-kit/src/api'
import { isRecord, keep, keepJson, stored, storedText } from '../../platform/src/api'

const STORAGE_KEY = 'orden:llm'
const CLIENT_KEY = 'orden:llm-client'
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
  private forgetting = false
  clients = $state<Connected[]>([])
  token = $state<Token | null>(null)
  client = $state<Client>('claude')
  readOnly = $state(true)
  freshToken = $state<string | null>(null)
  busy = $state(false)
  error = $state<string | null>(null)
  restore() {
    if (!this.forgetting) {
      this.forgetting = true
      account.forgetWithSession(() => {
        this.clients = []
        this.token = null
        this.freshToken = null
        this.busy = false
        this.error = null
      })
    }
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
    const token = account.accountToken
    if (!token) {
      this.clients = []
      this.token = null
      return
    }
    try {
      const listed = await api.connector(token)
      if (account.accountToken !== token) return
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
    const token = account.accountToken
    if (!token) return
    this.clients = this.clients.filter((one) => one.id !== id)
    this.error = null
    try {
      await api.disconnectClient(token, id)
    } catch (error) {
      if (account.accountToken === token) this.error = message(error, 'could not reach the server')
    } finally {
      await this.load()
    }
  }
  async createToken() {
    const session = account.accountToken
    if (!session) return
    this.busy = true
    this.error = null
    try {
      const { token } = await api.issueConnector(session, this.readOnly)
      if (account.accountToken !== session) return
      this.freshToken = token
      keepJson(STORAGE_KEY, { readOnly: this.readOnly })
      await this.load()
    } catch (error) {
      if (account.accountToken === session) this.error = message(error, 'could not create a token')
    } finally {
      if (account.accountToken === session) this.busy = false
    }
  }
  async revokeToken() {
    const token = account.accountToken
    if (!token) return
    this.busy = true
    this.error = null
    try {
      await api.revokeConnector(token)
      if (account.accountToken !== token) return
      this.freshToken = null
      await this.load()
    } catch (error) {
      if (account.accountToken === token) this.error = message(error, 'could not reach the server')
    } finally {
      if (account.accountToken === token) this.busy = false
    }
  }
  setReadOnly(on: boolean) {
    this.readOnly = on
    keepJson(STORAGE_KEY, { readOnly: on })
  }
}
export const connectors = new Connectors()
