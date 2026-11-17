import { beforeEach, describe, expect, test, vi } from 'vitest'

const asked = vi.hoisted(() => {
  const answer: unknown = null
  return { calls: [] as unknown[], answer }
})

vi.mock('../../platform/src/tauri', () => ({
  invoke: (command: string, args: unknown) => {
    asked.calls.push({ command, args })
    return Promise.resolve(asked.answer)
  },
}))

const { usage, weeklyIn } = await import('./usage.svelte')

const CLAUDE = {
  subscription_type: 'max',
  rate_limits: {
    five_hour: null,
    seven_day: { utilization: 92, resets_at: '2026-11-14T05:59:59.826962+00:00' },
  },
}

const CODEX = {
  rateLimits: {
    primary: { usedPercent: 71, windowDurationMins: 300, resetsAt: 1_800_000_000 },
    secondary: { usedPercent: 34, windowDurationMins: 10_080, resetsAt: 1_800_400_000 },
  },
}

describe('the weekly usage', () => {
  test('of a Claude plan is its seven-day window', () => {
    expect(weeklyIn('claude-code', CLAUDE)).toEqual({
      used: 92,
      resets: Date.parse('2026-11-14T05:59:59.826962+00:00'),
    })
  })

  test('of a ChatGPT plan through Codex is the week-long window, not the five-hour one', () => {
    expect(weeklyIn('codex', CODEX)).toEqual({ used: 34, resets: 1_800_400_000_000 })
  })

  test('of a plan that only has a short window is unknown', () => {
    const short = { rateLimits: { primary: CODEX.rateLimits.primary, secondary: null } }
    expect(weeklyIn('codex', short)).toBeNull()
  })

  test('stays between nothing and all of it', () => {
    const over = { rate_limits: { seven_day: { utilization: 130, resets_at: null } } }
    expect(weeklyIn('claude-code', over)).toEqual({ used: 100, resets: null })
  })

  test('is unknown for an answer with no week in it', () => {
    expect(weeklyIn('claude-code', { rate_limits: { seven_day: null } })).toBeNull()
    expect(weeklyIn('claude-code', null)).toBeNull()
    expect(weeklyIn('codex', 'nonsense')).toBeNull()
  })

  test('is never asked of an API key or a CLI without a weekly limit', () => {
    for (const kind of [
      'anthropic',
      'openai',
      'gemini',
      'compatible',
      'chatgpt',
      'gemini-cli',
    ] as const) {
      expect(weeklyIn(kind, CLAUDE)).toBeNull()
      expect(weeklyIn(kind, CODEX)).toBeNull()
    }
  })
})

describe('reading the usage', () => {
  beforeEach(() => {
    asked.calls = []
    asked.answer = null
    usage.forget('claude-code')
    usage.forget('anthropic')
  })

  test('asks the program of that account and keeps its week', async () => {
    asked.answer = CLAUDE
    await usage.look({ id: 'claude-code', kind: 'claude-code' }, true)
    expect(asked.calls).toEqual([
      { command: 'ai_cli_usage', args: { tool: 'claude-code', account: 'claude-code' } },
    ])
    expect(usage.of('claude-code')?.used).toBe(92)
  })

  test('asks again only after a while unless pressed', async () => {
    asked.answer = CLAUDE
    await usage.look({ id: 'claude-code', kind: 'claude-code' })
    await usage.look({ id: 'claude-code', kind: 'claude-code' })
    expect(asked.calls).toHaveLength(1)
    await usage.look({ id: 'claude-code', kind: 'claude-code' }, true)
    expect(asked.calls).toHaveLength(2)
  })

  test('never asks for an API key account', async () => {
    await usage.look({ id: 'anthropic', kind: 'anthropic' }, true)
    expect(asked.calls).toEqual([])
    expect(usage.of('anthropic')).toBeNull()
  })
})
