import type { Refusal } from '@orden/online/wire'
import type { Refused } from './calls'

export function refusalWords(why: Refused | Refusal): string | null {
  switch (why) {
    case 'gone':
      return 'This terminal is gone'
    case 'list':
      return 'Online terminals are not open to your account yet'
    case 'allowance':
      return 'This month’s online hours are used'
    case 'budget':
    case 'off':
      return 'Online terminals are paused for now'
    case 'flag':
      return 'This machine is stopped'
    case 'sessions':
      return 'Your machine has eight terminals already'
    case 'other':
      return 'Could not reach your machine'
    case 'signed-out':
      return 'Sign in to use an online terminal'
    case 'role':
    case 'rate':
    case 'large':
      return null
  }
}
