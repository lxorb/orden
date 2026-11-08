import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/caller'

const asked: { command: string; args: Record<string, unknown> }[] = []
let answer: Record<string, unknown> = { status: 'ok', result: {} }
vi.mock('../../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push({ command, args })
    return Promise.resolve(answer)
  },
}))

const copied: string[] = []
vi.mock('../../clipboard', () => ({
  copyText: (text: string) => {
    copied.push(text)
    return Promise.resolve()
  },
}))

const shown: {
  title: string
  body: string
  opened?: () => void
  reply?: { replied: (text: string) => void }
}[] = []
vi.mock('../../notify', () => ({
  show: (one: (typeof shown)[number]) => shown.push(one),
}))

const heard: ((event: { kind: string; agent: string | null }) => void)[] = []
vi.mock('../settings/crate', () => ({
  tauriCrate: {
    hear: (on: (event: { kind: string; agent: string | null }) => void) => {
      heard.push(on)
      return Promise.resolve(() => undefined)
    },
  },
}))

const revealed: string[] = []
vi.mock('../../focus', () => ({ revealPanel: (panel: string) => revealed.push(panel) }))

const { clipboard } = await import('./clipboard')
const { askReader } = await import('./ask')
const { asking } = await import('../ui/asking.svelte')
const { agentOpen } = await import('../../ai/sidebar/agent-open.svelte')

function call(verb: string, args: Record<string, unknown>, mode = 'unsupervised') {
  return {
    verb,
    args,
    caller: callerOf({ id: 'claude', name: 'Claude', scopes: ['clipboard', 'ask'], mode }),
  }
}

let pasted = 'what was copied'
vi.stubGlobal('navigator', { clipboard: { readText: () => Promise.resolve(pasted) } })

beforeEach(() => {
  asked.length = 0
  copied.length = 0
  shown.length = 0
  revealed.length = 0
  agentOpen.id = null
  answer = { status: 'ok', result: {} }
  pasted = 'what was copied'
})

describe('the clipboard', () => {
  test('is read as words that are not the reader’s, and written', async () => {
    expect(await clipboard(call('system_clipboard', { op: 'read' }))).toMatchObject({
      result: { text: 'what was copied' },
      untrusted: 'clipboard',
    })
    expect(await clipboard(call('system_clipboard', { op: 'write', text: 'hi' }))).toMatchObject({
      result: { written: 2 },
    })
    expect(copied).toEqual(['hi'])
    expect(asked).toEqual([])
  })

  test('asks before it is written in confirm mode, as every write does', async () => {
    answer = { status: 'needs_approval', approval: 'a1', summary: 'Copy' }
    expect(
      await clipboard(call('system_clipboard', { op: 'write', text: 'hi' }, 'confirm')),
    ).toMatchObject({ status: 'needs_approval' })
    expect(copied).toEqual([])
    expect(asked[0]).toMatchObject({ command: 'agents_ask', args: { category: 'writing' } })
  })

  test('takes read or write and nothing else', async () => {
    await expect(clipboard(call('system_clipboard', { op: 'paste' }))).rejects.toMatchObject({
      code: 'bad_arguments',
    })
  })
})

describe('a question put to the reader', () => {
  test('a notice is told and answered at once', async () => {
    expect(
      await askReader(call('ask_reader', { kind: 'notice', message: 'Build finished' })),
    ).toMatchObject({ result: { shown: true } })
    expect(shown[0]).toMatchObject({ title: 'Claude', body: 'Build finished' })
  })

  test('a choice is shown under the agent, and its answer comes back to the call', async () => {
    const waiting = askReader(
      call('ask_reader', { kind: 'choice', message: 'Deploy?', choices: ['Yes', 'No'] }),
    )
    await vi.waitFor(() => expect(asking.of('claude')).toHaveLength(1))
    const [question] = asking.of('claude')
    expect(question).toMatchObject({ kind: 'choice', choices: ['Yes', 'No'] })
    asking.answer(question?.id ?? '', 'Yes')
    expect(await waiting).toMatchObject({ result: { answer: 'Yes' } })
    expect(asking.of('claude')).toEqual([])
  })

  test('its notification opens the agent’s session, where it is answered (#1120)', async () => {
    const waiting = askReader(
      call('ask_reader', { kind: 'choice', message: 'Deploy?', choices: ['Yes', 'No'] }),
    )
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    shown[0]?.opened?.()
    expect(agentOpen.id).toBe('claude')
    expect(revealed).toEqual(['ask'])
    asking.forget('claude')
    expect(await waiting).toMatchObject({ result: { dismissed: true } })
  })

  test('a line typed in the notification is the answer too', async () => {
    const waiting = askReader(call('ask_reader', { kind: 'text', message: 'Branch name?' }))
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    shown[0]?.reply?.replied('fix-1125')
    expect(await waiting).toMatchObject({ result: { answer: 'fix-1125' } })
  })

  test('not answered in time is its id, asked about again; put away is dismissed', async () => {
    const first = await askReader(
      call('ask_reader', { kind: 'text', message: 'Name?', wait_ms: 1 }),
    )
    expect(first).toMatchObject({ result: { waiting: true } })
    const id = (first as { result: { id: string } }).result.id

    asking.answer(id, null)
    expect(await askReader(call('ask_reader', { id, wait_ms: 1 }))).toMatchObject({
      result: { id, dismissed: true },
    })
  })

  test('at most five of an agent’s questions are open at once', async () => {
    const ids: string[] = []
    for (let one = 0; one < 5; one++) {
      const said = await askReader(
        call('ask_reader', { kind: 'text', message: `Name ${one}?`, wait_ms: 1 }),
      )
      ids.push((said as { result: { id: string } }).result.id)
    }
    await expect(
      askReader(call('ask_reader', { kind: 'text', message: 'Again?', wait_ms: 1 })),
    ).rejects.toMatchObject({ code: 'bad_arguments' })
    expect(asking.of('claude')).toHaveLength(5)

    asking.answer(ids[0] ?? '', 'Ada')
    expect(
      await askReader(call('ask_reader', { kind: 'text', message: 'Again?', wait_ms: 1 })),
    ).toMatchObject({ result: { waiting: true } })
    asking.forget('claude')
  })

  test('another agent’s question is not this one’s to ask about', async () => {
    const theirs = asking.ask({
      agent: 'codex',
      kind: 'text',
      message: 'Secret?',
      choices: [],
      placeholder: null,
    })
    await expect(askReader(call('ask_reader', { id: theirs.id }))).rejects.toMatchObject({
      code: 'bad_arguments',
    })
  })

  test('a choice offers between one and twelve, and a kind is one of three', async () => {
    await expect(
      askReader(call('ask_reader', { kind: 'choice', message: 'Pick', choices: [] })),
    ).rejects.toMatchObject({ code: 'bad_arguments' })
    await expect(
      askReader(call('ask_reader', { kind: 'shout', message: 'Hi' })),
    ).rejects.toMatchObject({ code: 'bad_arguments' })
    const long = 'x'.repeat(201)
    await expect(
      askReader(call('ask_reader', { kind: 'choice', message: 'Pick', choices: ['Yes', long] })),
    ).rejects.toMatchObject({ code: 'bad_arguments' })
    await expect(
      askReader(call('ask_reader', { kind: 'text', message: 'Name?', placeholder: long })),
    ).rejects.toMatchObject({ code: 'bad_arguments' })
  })

  test('an agent that goes, or is stopped, takes its questions with it', async () => {
    const waiting = askReader(call('ask_reader', { kind: 'text', message: 'Still there?' }))
    await vi.waitFor(() => expect(asking.of('claude')).toHaveLength(1))
    asking.keepOnly(new Set(['codex']))
    expect(await waiting).toMatchObject({ result: { dismissed: true } })
    expect(asking.of('claude')).toEqual([])
  })

  test('pausing the agent ends its wait for an answer at once, and another agent’s pause does not', async () => {
    const waiting = askReader(
      call('ask_reader', { kind: 'choice', message: 'Go on?', choices: ['Yes'], wait_ms: 60_000 }),
    )
    await vi.waitFor(() => expect(asking.of('claude')).toHaveLength(1))
    await vi.waitFor(() => expect(heard.length).toBeGreaterThan(0))
    for (const on of heard) on({ kind: 'paused', agent: 'codex' })
    for (const on of heard) on({ kind: 'paused', agent: 'claude' })
    await expect(waiting).rejects.toMatchObject({ code: 'stopped' })
    asking.keepOnly(new Set())
  })

  test('the command line asks the reader nothing', async () => {
    await expect(
      askReader({
        verb: 'ask_reader',
        args: { kind: 'notice', message: 'x' },
        caller: callerOf(null),
      }),
    ).rejects.toMatchObject({ code: 'by_hand' })
  })
})
