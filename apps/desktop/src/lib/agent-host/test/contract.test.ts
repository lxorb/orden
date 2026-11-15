import { describe, expect, test } from 'vitest'
import { answerTheCrate, hostVerbs, keepMarksOf } from '../src/api'

const READER = { agent: null }

describe('the host', () => {
  test('answers the core verbs and leaves the features their own', () => {
    for (const verb of ['get_context', 'read_note', 'workspace_tabs', 'ask_reader', 'bookmarks']) {
      expect(typeof hostVerbs[verb]).toBe('function')
    }
    for (const verb of ['explorer_tabs', 'application_tabs', 'list_chats', 'run_terminal']) {
      expect(hostVerbs[verb]).toBeUndefined()
    }
    expect(typeof keepMarksOf).toBe('function')
  })

  test('a verb told too little answers a refusal and never throws', async () => {
    expect(await hostVerbs.workspace_tabs?.('workspace_tabs', {}, READER)).toMatchObject({
      ok: false,
      code: 'bad_arguments',
    })
  })

  test('the crate asks only what the host answers', async () => {
    await expect(answerTheCrate('agent.nothing', {})).rejects.toThrow('there is no verb called')
  })
})
