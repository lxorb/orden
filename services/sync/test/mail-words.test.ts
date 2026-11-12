import { describe, expect, test } from 'vitest'
import {
  codeMessage,
  goneMessage,
  inviteMessage,
  leavingMessage,
  requestMessage,
} from '../src/sync-server/src/email'

const SENT = {
  code: codeMessage('123456'),
  leaving: leavingMessage('123456'),
  gone: goneMessage(),
  invite: inviteMessage({
    space: 'Plans',
    from: 'Sam',
    role: 'write',
    link: 'https://orden.so/join/a',
  }),
  shared: inviteMessage({
    space: 'Plans',
    from: 'Sam',
    role: 'read',
    link: 'https://orden.so/join/a',
    item: 'Monday.md',
  }),
  request: requestMessage({ space: 'Plans', who: 'Kim', link: 'https://orden.so/s/a' }),
}

const OLD_NAME = /(?<![A-Za-z@./])(?:Nib|nibeditor)(?![A-Za-z@])/i

describe('every message the service sends', () => {
  test('never calls the app by its old name', () => {
    for (const [kind, message] of Object.entries(SENT)) {
      for (const part of [message.subject, message.text, message.html]) {
        expect(part, kind).not.toMatch(OLD_NAME)
      }
    }
  })

  test('names it where it names it at all', () => {
    expect(SENT.code.subject).toBe('123456 is your Orden code')
    expect(SENT.leaving.subject).toBe('123456 deletes your Orden account')
    expect(SENT.leaving.text).toContain('Your code to delete your Orden account is 123 456.')
    expect(SENT.gone.subject).toBe('Your Orden account has been deleted')
    expect(SENT.invite.text).toContain('Sam shared the space Plans with you on Orden')
    expect(SENT.shared.text).toContain('Sam shared the note Monday.md with you on Orden')
    expect(SENT.invite.text).toContain('Orden emails you a code')
    expect(SENT.request.html).toContain('>Open Orden</a>')
  })
})
