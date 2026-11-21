import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8')
test('the chats beside a chat stay as wide as their shelf, however long a row is (#2425)', () => {
  expect(/\.threads \{[^}]*min-width: 0;/.exec(read('Threads.svelte'))).not.toBeNull()
  expect(/\.shelf \{[^}]*overflow: hidden;/.exec(read('ChatPanel.svelte'))).not.toBeNull()
})
