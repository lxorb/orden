import { type Base, pressed, readButtons, type Row } from '@orden/bases'
import { openExternal } from '../platform/src/api'
import { pressRow } from './act'
import { nowHere } from './days'

export async function pressButton(base: Base, name: string, row: Row): Promise<void> {
  const button = readButtons(base).find((one) => one.name === name)
  if (!button) return
  const now = nowHere()
  const press = pressed(button, {
    title: row.file.basename,
    today: now.slice(0, 10),
    time: now.slice(11, 16),
  })
  await pressRow(row, { note: press.set })
  if (press.command !== undefined) {
    const { runCommand } = await import('../automation/acts')
    try {
      runCommand({ id: press.command }, 'link')
    } catch {
      // A command that is gone or may not run from here does nothing; the rest of the
      // press already happened.
    }
  }
  if (press.open !== undefined) await openExternal(press.open)
}
