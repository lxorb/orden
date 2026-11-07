import { expect, test, vi } from 'vitest'
import { invoke } from './tauri'

test('no command reaches a file for the account inbox, so none can make one', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  for (const command of ['read_note', 'write_note', 'file_stamp', 'snapshot_note']) {
    await expect(
      invoke(command, { path: '/home/.orden-inbox.md', content: '- [ ] x' }),
    ).rejects.toThrow(/not in a file/)
  }
  expect(warn).toHaveBeenCalledTimes(4)
  warn.mockRestore()
})
