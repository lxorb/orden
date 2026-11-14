import { registerSettingsPart } from '@orden/contracts'
import { partView } from '../../ui-kit/src/api'
import { reach } from './settings/reach.svelte'

if (!__EVEN_PLUGIN__) {
  registerSettingsPart({
    section: 'ai',
    card: false,
    shown: () => true,
    places: () =>
      reach.offered
        ? [
            {
              label: 'Agents',
              text: ['MCP', 'orden mcp', 'Claude Code', 'Codex', 'token', 'Create a token'],
            },
          ]
        : [],
    load: async () =>
      partView((await import('./access/Access.svelte')).default, (host) => ({
        ondetail: (open: boolean) => host.detail(open),
      })),
  })
}
