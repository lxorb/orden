import type { Refusal } from '@orden/online/wire'
import type { Refused } from './calls'

const WORDS: Record<Refused | Refusal, string | null> = {
  gone: 'This terminal is gone',
  list: 'Online terminals are not open to your account yet',
  allowance: 'This month’s online hours are used',
  budget: 'Online terminals are paused for now',
  off: 'Online terminals are paused for now',
  flag: 'This machine is stopped',
  sessions: 'Your machine has eight terminals already',
  other: 'Could not reach your machine',
  'signed-out': 'Sign in to use an online terminal',
  role: null,
  rate: null,
  large: null,
}

export const refusalWords = (why: Refused | Refusal): string | null => WORDS[why]
