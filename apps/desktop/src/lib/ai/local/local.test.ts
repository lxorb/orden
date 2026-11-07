import { describe, expect, test } from 'vitest'
import { promptFor } from './prompt'
import { loginLine, signingShell } from './signin'
import { saidIn, standingOf } from './standing'
import { troubleOf } from './trouble'
import { modelsIn } from './models'

describe('a conversation as one prompt', () => {
  test('the rules, the conversation, then the question', () => {
    const prompt = promptFor([
      { role: 'system', content: 'Cite by number.' },
      { role: 'system', content: '<passage n="1">Herons</passage>' },
      { role: 'user', content: 'What waits?' },
      { role: 'assistant', content: 'Herons [1].' },
      { role: 'user', content: 'For how long?' },
    ])

    expect(prompt).toBe(
      [
        '<instructions>\nCite by number.\n\n<passage n="1">Herons</passage>\n</instructions>',
        '<conversation>\n<user>\nWhat waits?\n</user>\n<assistant>\nHerons [1].\n</assistant>\n</conversation>',
        '<user>\nFor how long?\n</user>',
      ].join('\n\n'),
    )
  })

  test('a lone question is just the question', () => {
    expect(promptFor([{ role: 'user', content: 'Hi' }])).toBe('<user>\nHi\n</user>')
  })
})

const ENDED = { code: 0, timedOut: false, stopped: false, err: '' }

describe('a run that did not answer', () => {
  test('an answer is no trouble', () => {
    expect(troubleOf('Claude Code', 'Claude', {}, ENDED, true)).toBeNull()
  })

  test('the plan at its limit is the reader’s own plan', () => {
    const said = troubleOf(
      'Claude Code',
      'Claude',
      { limit: { state: 'reached', until: null, untilWords: null } },
      { ...ENDED, code: 1 },
      false,
    )
    expect(said).toBe('Your Claude plan is at its limit for now.')

    const until = troubleOf(
      'Codex',
      'ChatGPT',
      { limit: { state: 'reached', until: null, untilWords: '3:05 PM' } },
      { ...ENDED, code: 1 },
      false,
    )
    expect(until).toBe('Your ChatGPT plan is at its limit until 3:05 PM.')
  })

  test('signed out, out of time and out of date each say what to do', () => {
    expect(troubleOf('Codex', 'ChatGPT', { signedOut: true, trouble: 'x' }, ENDED, false)).toBe(
      'Sign in to Codex first.',
    )
    expect(troubleOf('Codex', 'ChatGPT', {}, { ...ENDED, code: null, timedOut: true }, false)).toBe(
      'Codex took too long to answer.',
    )
    expect(
      troubleOf(
        'Claude Code',
        'Claude',
        {},
        { ...ENDED, code: 1, err: "error: unknown option '--tools'" },
        false,
      ),
    ).toBe('Claude Code is out of date. Update it and try again.')
  })

  test('anything else is the program’s own last word', () => {
    expect(
      troubleOf(
        'Codex',
        'ChatGPT',
        {},
        { ...ENDED, code: 3, err: 'warn\nthe real reason\n' },
        false,
      ),
    ).toBe('the real reason')
    expect(troubleOf('Codex', 'ChatGPT', {}, { ...ENDED, code: 3 }, false)).toBe(
      'The model did not answer.',
    )
  })
})

describe('whether a program is signed in, as it says', () => {
  const said = (out: string, code: number, err = '') =>
    saidIn({ program: 'C:\\bin\\claude.cmd', out, code, err, timedOut: false })

  test('not installed', () => {
    expect(standingOf('claude-code', null).state).toBe('missing')
    expect(saidIn({ out: 'no program' })).toBeNull()
  })

  test('Claude Code names its plan and whose it is', () => {
    const status = JSON.stringify(
      { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'r@example.com' },
      null,
      2,
    )
    expect(standingOf('claude-code', said(status, 0))).toEqual({
      state: 'in',
      program: 'C:\\bin\\claude.cmd',
      plan: 'Max',
      account: 'r@example.com',
    })
    expect(standingOf('claude-code', said('{"loggedIn": false}', 1)).state).toBe('out')
    expect(
      standingOf('claude-code', said('{"loggedIn": true, "authMethod": "console"}', 0)).plan,
    ).toBe('API key')
  })

  test('an older Claude Code with no status is left to the question', () => {
    expect(standingOf('claude-code', said('', 0)).state).toBe('unknown')
    expect(standingOf('claude-code', said('', 1, 'error: unknown command')).state).toBe('out')
  })

  test('Codex says it on stderr', () => {
    expect(standingOf('codex', said('', 0, 'Logged in using ChatGPT')).plan).toBe('ChatGPT')
    expect(standingOf('codex', said('', 0, 'Logged in using an API key - sk-...')).plan).toBe(
      'API key',
    )
    expect(standingOf('codex', said('', 1, 'Not logged in')).state).toBe('out')
  })
})

describe('the line a terminal signs in with', () => {
  test('Command Prompt gets the path in double quotes', () => {
    expect(loginLine('claude-code', 'C:/Users/A B/npm/claude.cmd', true)).toBe(
      '"C:/Users/A B/npm/claude.cmd" auth login',
    )
  })

  test('a POSIX shell gets it in single quotes, a quote in it closed and reopened', () => {
    expect(loginLine('codex', "/Users/o'neil/.local/bin/codex", false)).toBe(
      String.raw`'/Users/o'\''neil/.local/bin/codex' login`,
    )
  })

  test('a second account signs in in its own home, set for the program alone', () => {
    const home = 'C:/Users/A B/AppData/Local/orden/ai/homes/claude-code-2'
    expect(loginLine('claude-code', 'C:/npm/claude.cmd', true, false, home)).toBe(
      `set "CLAUDE_CONFIG_DIR=${home}" && "C:/npm/claude.cmd" auth login`,
    )
    expect(loginLine('codex', '/usr/bin/codex', false, true, "/home/o'n/ai/homes/codex-2")).toBe(
      String.raw`CODEX_HOME='/home/o'\''n/ai/homes/codex-2' '/usr/bin/codex' logout`,
    )
  })
})

describe('the shell a sign-in is typed into', () => {
  const shell = (id: string) => ({ id })
  const list = [shell('/usr/bin/pwsh'), shell('/usr/bin/nu'), shell('/bin/zsh'), shell('/bin/bash')]

  test('is one that reads the line as written, whatever shell is chosen for new tabs', () => {
    expect(signingShell(list, shell('/usr/bin/pwsh'), false)?.id).toBe('/bin/zsh')
    expect(signingShell(list, shell('/bin/tcsh'), false)?.id).toBe('/bin/zsh')
    expect(signingShell(list, shell('/opt/homebrew/bin/fish'), false)?.id).toBe(
      '/opt/homebrew/bin/fish',
    )
    expect(signingShell(list, shell('/bin/bash'), false)?.id).toBe('/bin/bash')
    expect(signingShell([shell('cmd'), shell('pwsh')], shell('pwsh'), true)?.id).toBe('cmd')
  })
})

describe('the Gemini CLI', () => {
  const said = (out: string) => ({ program: '/bin/gemini', out, code: 0, err: '', timedOut: false })

  test('is signed in with Google, a key or Vertex AI, as Orden read its folder', () => {
    expect(
      standingOf(
        'gemini-cli',
        said('{"signedIn":true,"method":"google","email":"heron@example.com"}'),
      ),
    ).toEqual({ state: 'in', program: '/bin/gemini', plan: null, account: 'heron@example.com' })
    expect(standingOf('gemini-cli', said('{"signedIn":true,"method":"api-key"}')).plan).toBe(
      'API key',
    )
    expect(standingOf('gemini-cli', said('{"signedIn":true,"method":"vertex"}')).plan).toBe(
      'Vertex AI',
    )
    expect(standingOf('gemini-cli', said('{"signedIn":false}')).state).toBe('out')
    expect(standingOf('gemini-cli', said('0.99.0')).state).toBe('unknown')
  })

  test('signs in by starting it, in its own home where the account has one', () => {
    expect(loginLine('gemini-cli', '/usr/bin/gemini', false)).toBe(`'/usr/bin/gemini'`)
    expect(loginLine('gemini-cli', 'C:/npm/gemini.cmd', true, false, 'C:/h/gemini-cli-2')).toBe(
      'set "GEMINI_CLI_HOME=C:/h/gemini-cli-2" && "C:/npm/gemini.cmd"',
    )
  })

  test('offers its own aliases for models, words only', () => {
    const models = modelsIn('gemini-cli', null)
    expect(models.map((one) => one.id)).toEqual(['auto', 'pro', 'flash', 'flash-lite'])
    expect(models.every((one) => !one.images && one.efforts.join() === 'auto')).toBe(true)
  })
})
