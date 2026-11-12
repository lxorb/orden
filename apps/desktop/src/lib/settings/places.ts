import { account } from '../account.svelte'
import { reach } from '../agents/settings/reach.svelte'
import type { Place } from '../settings-search'
import { isDesktop } from '../tauri'

export function places(): Place[] {
  const all: Place[] = [
    { section: 'account', label: 'Display name', text: [] },
    { section: 'account', label: 'Email', text: [account.user?.email ?? ''] },
    { section: 'account', label: 'Storage', text: [] },
    { section: 'account', label: account.user ? 'Sign out' : 'Sign in', text: [] },
    {
      section: 'account',
      label: 'Signing in',
      text: [
        'Two-factor authentication',
        '2FA',
        'two-factor',
        'TOTP',
        'authenticator',
        'Recovery codes left',
      ],
    },
    { section: 'account', label: 'Signed in on', text: ['End every other session'] },
    ...(account.user ? [{ section: 'account' as const, label: 'Delete account', text: [] }] : []),
    {
      section: 'sync',
      label: 'When the same note was written twice',
      text: ['Keep both copies', 'Let the newest win', 'Ask me each time'],
    },
    {
      section: 'sync',
      label: 'History on the account',
      text: ['Keep versions', 'A month', 'A year'],
    },
    { section: 'sync', label: 'What synced', text: [] },
    { section: 'sync', label: 'Go back', text: ['This space, as it was'] },
    ...(__EVEN_PLUGIN__
      ? []
      : [{ section: 'space' as const, label: 'Agent instructions', text: ['AGENTS.md'] }]),
    { section: 'appearance', label: 'Themes', text: ['Browse', 'Install'] },
    { section: 'editor', label: 'Reset to defaults', text: [] },
    { section: 'shortcuts', label: 'Vim keys', text: ['vim'] },
    { section: 'markdown', label: 'Reset to defaults', text: [] },
  ]

  if (isDesktop) {
    all.push({
      section: 'appearance',
      label: 'Reload themes and custom CSS',
      text: ['Custom'],
    })
    all.push({ section: 'general', label: 'Default browser', text: ['Make default'] })
  }

  if (!__EVEN_PLUGIN__ && reach.offered) {
    all.push({
      section: 'ai',
      label: 'Agents',
      text: ['MCP', 'orden mcp', 'Claude Code', 'Codex', 'token', 'Create a token'],
    })
  }

  if (!__EVEN_PLUGIN__ && isDesktop) {
    all.push({
      section: 'remote',
      label: 'Add host',
      text: ['SSH', 'ssh config', 'Remote', 'Open config'],
    })
  }

  if (!__EVEN_PLUGIN__ && account.user) {
    all.push({
      section: 'online',
      label: 'Online terminal',
      text: ['Machine', 'Start', 'Stop', 'Hours', 'CPU'],
    })
  }

  if (account.user) {
    all.push({
      section: 'ai',
      label: 'LLM access',
      text: ['MCP', 'Claude', 'ChatGPT', 'token', 'Connect', 'Create a token'],
    })
  }

  return all
}
