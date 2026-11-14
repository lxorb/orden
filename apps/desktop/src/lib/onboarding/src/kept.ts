import { isRecord, keepJson, stored } from '../../platform/src/api'
import type { Answers, Step } from './flow'
import { isStep } from './flow'
import { PROGRESS_KEY } from './gate.svelte'

const REQUESTS_KEY = 'orden:setup-requests'
const HEARD_KEY = 'orden:setup-heard'

export interface Progress {
  step: Step
  answers: Answers
}

export type Kept = Progress | 'done' | null

export function keptProgress(said: unknown): Kept {
  if (said === 'done') return 'done'
  if (!isRecord(said) || !isStep(said.step)) return null
  const answers = isRecord(said.answers) ? said.answers : {}
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  const code = answers.code === 'yes' || answers.code === 'no' ? answers.code : null
  return {
    step: said.step,
    answers: { browser: text(answers.browser), notes: text(answers.notes), code },
  }
}

export function readProgress(): Kept {
  return keptProgress(stored(PROGRESS_KEY))
}

export function keepProgress(progress: Progress | 'done'): void {
  keepJson(PROGRESS_KEY, progress)
}

function requested(): string[] {
  const kept = stored(REQUESTS_KEY)
  return Array.isArray(kept) ? kept.filter((one): one is string => typeof one === 'string') : []
}

export function hasRequested(key: string): boolean {
  return requested().includes(key)
}

export function request(key: string): void {
  const held = requested()
  if (!held.includes(key)) keepJson(REQUESTS_KEY, [...held, key])
}

export function heardBefore(): boolean {
  return stored(HEARD_KEY) !== null
}

export function keepHeard(answer: { id: string; said: string } | null): void {
  keepJson(HEARD_KEY, answer)
}
