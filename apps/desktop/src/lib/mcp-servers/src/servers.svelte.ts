import { invoke } from '../../platform/src/api'
import { prompt } from '../../ui-kit/src/api'
import { type Permission, type Pick, type Secrets, type Server, type ServerView, type State, said } from './mcp'

class McpServers {
  list = $state<ServerView[]>([])
  read = $state(false)
  problem = $state('')
  private users = 0
  private asked = 0
  private unlisten: (() => void) | null = null
  open(): () => void {
    this.users += 1
    if (this.users === 1) {
      void this.listen()
      void this.load()
    }
    return () => {
      this.users -= 1
      if (this.users > 0) return
      this.unlisten?.()
      this.unlisten = null
    }
  }
  private async listen() {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const stop = await listen<{ id: string; state: State }>('orden://mcp', (event) => this.heard(event.payload))
      if (this.users > 0) this.unlisten = stop
      else stop()
    } catch {
      return
    }
  }
  heard(news: { id: string; state: State }) {
    this.list = this.list.map((one) => (one.id === news.id ? { ...one, state: news.state } : one))
    void this.load()
  }
  async load(): Promise<void> {
    const mine = ++this.asked
    try {
      const list = await invoke<ServerView[]>('mcp_servers')
      if (mine !== this.asked) return
      this.list = list
      this.problem = ''
    } catch (error) {
      if (mine === this.asked) this.problem = said(error)
    } finally {
      if (mine === this.asked) this.read = true
    }
  }
  byId(id: string): ServerView | null {
    return this.list.find((one) => one.id === id) ?? null
  }
  private put(view: ServerView) {
    this.asked += 1
    this.read = true
    const at = this.list.findIndex((one) => one.id === view.id)
    this.list = at < 0 ? [...this.list, view] : this.list.map((one, index) => (index === at ? view : one))
  }
  private async call(command: string, args: Record<string, unknown>): Promise<ServerView | null> {
    this.problem = ''
    try {
      const view = await invoke<ServerView>(command, args)
      this.put(view)
      return view
    } catch (error) {
      this.problem = said(error)
      return null
    }
  }
  save(server: Server, secrets: Secrets | null): Promise<ServerView | null> {
    return this.call('mcp_server_save', secrets ? { server, secrets } : { server })
  }
  switch(id: string, on: boolean) {
    return this.call('mcp_server_switch', { id, on })
  }
  permission(id: string, tool: string, permission: Permission) {
    return this.call('mcp_tool_permission', { id, tool, permission })
  }
  restart(id: string) {
    return this.call('mcp_server_restart', { id })
  }
  async remove(view: ServerView): Promise<boolean> {
    const sure = await prompt.confirm({
      title: `Remove ${view.name}?`,
      detail: 'Orden stops it and forgets its saved values.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!sure) return false
    this.problem = ''
    try {
      await invoke('mcp_server_remove', { id: view.id })
      this.asked += 1
      this.list = this.list.filter((one) => one.id !== view.id)
      return true
    } catch (error) {
      this.problem = said(error)
      return false
    }
  }
  async imported(picks: Pick[]): Promise<ServerView[]> {
    const views = await invoke<ServerView[]>('mcp_import', { picks })
    for (const view of views) this.put(view)
    return views
  }
}
export const mcp = new McpServers()
