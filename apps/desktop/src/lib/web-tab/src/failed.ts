import type { Mood } from '../../mascot/src/api'
import type { Failure } from './upgrade'

export function failedLook(failure: Failure | null, site: string): { mood: Mood; line: string } {
  switch (failure) {
    case 'offline':
      return { mood: 'offline', line: 'No internet' }
    case 'unknown':
      return { mood: 'lost', line: `Can’t find ${site}` }
    case 'unreachable':
      return { mood: 'shrug', line: `${site} isn’t answering` }
    case 'slow':
      return { mood: 'sleepy', line: `${site} took too long to answer` }
    case 'certificate':
      return { mood: 'suspicious', line: `${site} can’t prove who it is` }
    case 'blocked':
      return { mood: 'stern', line: 'This page is blocked' }
    case 'other':
      return { mood: 'unsure', line: 'This page didn’t load' }
    case null:
      return { mood: 'dizzy', line: 'This page crashed' }
  }
}
