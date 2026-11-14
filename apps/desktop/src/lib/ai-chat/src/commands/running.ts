import { readOutside } from '../chat/transcript'
import type { Goal, GoalState, Thread } from '../../../ai-providers/src/api'
import { tokens } from './account'
import { evaluatorMessages, shown, verdictIn } from './evaluate'
import { goalAsk, guidance, newGoal, pursue, type GoalRoad } from './goal'
import { type Host, waitFor } from './host'
import { loopAsk, loopPrompt, runLoop } from './loop'
import { tasks } from './tasks.svelte'

function goalWord(state: GoalState): string {
  switch (state) {
    case 'met':
      return 'Goal met'
    case 'impossible':
      return 'Goal cannot be met'
    case 'budget_limited':
      return 'Goal budget spent'
    case 'paused':
      return 'Goal paused'
    case 'cleared':
      return 'Goal cleared'
    case 'pursuing':
      return 'Goal'
  }
}

function goalStatus(goal: Goal, now: number): string {
  const minutes = Math.round((now - goal.started) / 60_000)
  return [
    `◎ ${goalWord(goal.state)}: ${goal.condition}`,
    `${minutes}m, ${goal.turns}/${goal.budget.turns}, ${tokens(goal.tokens)}`,
    goal.reason ?? '',
  ]
    .filter(Boolean)
    .join('\n')
}

function road(host: Host, thread: Thread, signal: AbortSignal): GoalRoad {
  return {
    turn: (text) => host.turn(thread, text, { signal }),
    evaluate: async (condition, since) =>
      verdictIn(await host.ask(thread, evaluatorMessages(condition, shown(thread, since)), signal)),
    changed: () => host.touched(thread),
    ended: (goal, why) => host.line(thread, `◎ ${goalWord(goal.state)}${why ? `: ${why}` : ''}`),
    wait: waitFor,
    now: () => Date.now(),
  }
}

function start(host: Host, thread: Thread, goal: Goal, first?: string): void {
  tasks.stop(thread.id, 'goal')
  const stopper = new AbortController()
  const task = tasks.add({
    thread: thread.id,
    kind: 'goal',
    label: goal.condition,
    stop: () => {
      stopper.abort()
      if (goal.state === 'pursuing') {
        goal.state = 'paused'
        host.touched(thread)
      }
    },
  })
  void pursue(goal, road(host, thread, stopper.signal), stopper.signal, first).finally(() =>
    tasks.done(task.id),
  )
}

export function goal(host: Host, thread: Thread, args: string): void {
  const asked = goalAsk(args)
  const held = thread.goal
  switch (asked.do) {
    case 'status':
      host.line(thread, held ? goalStatus(held, Date.now()) : '∅')
      return
    case 'pause':
      tasks.stop(thread.id, 'goal')
      return
    case 'resume':
      if (held?.state === 'paused')
        start(
          host,
          thread,
          held,
          guidance(held.condition, held.reason ?? '', readOutside(thread.turns)),
        )
      return
    case 'clear':
      tasks.stop(thread.id, 'goal')
      if (held) {
        held.state = 'cleared'
        host.line(thread, `◎ ${goalWord('cleared')}: ${held.condition}`)
      }
      return
    case 'set': {
      const made = newGoal(thread, asked.condition, Date.now())
      thread.goal = made
      start(host, thread, made)
    }
  }
}

export function loop(host: Host, thread: Thread, args: string): void {
  const asked = loopAsk(args)
  const prompt = loopPrompt(asked, thread)
  const stopper = new AbortController()
  const task = tasks.add({
    thread: thread.id,
    kind: 'loop',
    label: prompt,
    stop: () => stopper.abort(),
  })
  void runLoop(
    asked,
    prompt,
    {
      turn: (text, signal) => host.turn(thread, text, { signal }),
      wait: waitFor,
      ended: (why) => host.line(thread, `↻ ${why || '✓'}`),
    },
    stopper.signal,
  ).finally(() => tasks.done(task.id))
}
