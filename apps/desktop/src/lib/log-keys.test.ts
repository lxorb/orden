import { expect, test, vi } from 'vitest'

const sent = vi.hoisted(() => [] as { command: string; args: Record<string, unknown> }[])

vi.mock('./tauri', () => ({
  isNative: true,
  isDesktop: true,
  invoke: (command: string, args: Record<string, unknown>) => {
    sent.push({ command, args })
    return Promise.resolve()
  },
}))

const { log, recentLog } = await import('./log')

test('a key said in a log line never reaches the log file or the kept lines', () => {
  log('error', 'ai: 401 for key sk-proj-abcdefghijklmnop1234 with Bearer abcdef123456')
  const written = JSON.stringify(sent)
  expect(written).not.toContain('sk-proj-abcdefghijklmnop1234')
  expect(written).not.toContain('abcdef123456')
  expect(recentLog().join('\n')).not.toContain('sk-proj')
  expect(written).toContain('<token>')
})
