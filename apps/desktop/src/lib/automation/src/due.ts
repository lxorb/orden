import { type AgentAnswer, agentRefusal } from '@orden/contracts'

const LAST_WORD = 1000

const STILL_GOING =
  'the time to answer ran out while this was still being done, and it may yet be done: look before asking for it again'

export interface Due {
  readonly deadline: AbortSignal | undefined
  readonly late: Promise<AgentAnswer>
  end(): void
}

const NEVER = new Promise<AgentAnswer>(() => undefined)

export function dueWithin(within: unknown): Due {
  if (typeof within !== 'number' || !Number.isFinite(within)) {
    return { deadline: undefined, late: NEVER, end: () => undefined }
  }

  const ms = Math.max(0, within)
  const stopping = new AbortController()
  const stops = setTimeout(() => stopping.abort(), Math.max(0, ms - LAST_WORD))
  let answers: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<AgentAnswer>((answer) => {
    answers = setTimeout(() => answer(agentRefusal('timeout', STILL_GOING)), ms)
  })

  return {
    deadline: stopping.signal,
    late,
    end: () => {
      clearTimeout(stops)
      clearTimeout(answers)
    },
  }
}
