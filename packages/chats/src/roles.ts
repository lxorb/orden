import type { Event, Posting, Role } from './types'

export type Action =
  | 'read'
  | 'post'
  | 'edit-own'
  | 'delete-own'
  | 'delete-any'
  | 'pin'
  | 'topic'
  | 'posting'
  | 'slowmode'

export function may(role: Role | null, action: Action, posting: Posting): boolean {
  if (role === null) return false
  switch (action) {
    case 'read':
      return true
    case 'post':
      return role === 'owner' || (role === 'write' && posting === 'writers')
    case 'edit-own':
    case 'delete-own':
    case 'pin':
    case 'topic':
      return role !== 'read'
    case 'delete-any':
    case 'posting':
    case 'slowmode':
      return role === 'owner'
  }
}

export function actionsOf(event: Event, mine: boolean): Action[] {
  switch (event.kind) {
    case 'post':
    case 'schedule':
    case 'react':
    case 'vote':
      return ['post']
    case 'edit':
      return mine ? ['edit-own'] : []
    case 'delete':
      return [mine ? 'delete-own' : 'delete-any']
    case 'pin':
      return ['pin']
    case 'meta': {
      const actions: Action[] = []
      if (event.topic !== undefined) actions.push('topic')
      if (event.posting !== undefined) actions.push('posting')
      if (event.slowmode !== undefined) actions.push('slowmode')
      return actions
    }
  }
}

export function mayEvent(
  role: Role | null,
  event: Event,
  mine: boolean,
  posting: Posting,
): boolean {
  const actions = actionsOf(event, mine)
  return actions.length > 0 && actions.every((action) => may(role, action, posting))
}
