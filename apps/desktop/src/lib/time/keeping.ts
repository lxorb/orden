import { chooseFiles } from '../choose-files'
import { deliver } from '../export/save'
import { time } from './time.svelte'
import { csvOf, jsonOf, recordsIn } from './written'

const NAME = 'Time'

export async function exportCsv(): Promise<void> {
  await deliver(NAME, 'csv', 'Spreadsheet', {
    text: csvOf(time.spans, time.activities, Date.now()),
    mime: 'text/csv',
  })
}

export async function exportJson(): Promise<void> {
  await deliver(NAME, 'json', 'JSON', { text: jsonOf(time.everything()), mime: 'application/json' })
}

export async function importJson(): Promise<number | null> {
  const [file] = await chooseFiles({ accept: '.json,application/json' })
  if (!file) return null
  const records = recordsIn(await file.text())
  return records ? time.bring(records) : null
}
