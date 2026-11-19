import { registerSettingsPart } from '@orden/contracts'
import { isDesktop } from '../../platform/src/api'
import { partView } from '../../ui-kit/src/api'

const SOURCES = ['Claude Desktop', 'Claude Code', 'Cursor', 'VS Code', 'Codex', 'Windsurf', 'Gemini CLI']
registerSettingsPart({
  section: 'ai',
  title: 'MCP servers',
  card: false,
  order: 1,
  shown: () => isDesktop,
  places: () =>
    isDesktop
      ? [{ label: 'MCP servers', text: ['MCP', 'Add server', 'Import', 'Import from other apps', 'Tools', ...SOURCES] }]
      : [],
  load: async () =>
    partView((await import('./McpServers.svelte')).default, (host) => ({
      ondetail: (open: boolean) => host.detail(open),
    })),
})
