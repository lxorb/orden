import { cellValue, csvText, csvValue, isButton, sheetSafe } from '@orden/bases'
import { copyText } from '../clipboard'
import { deliver } from '../export/save'
import { t } from '../i18n.svelte'
import { displayName } from './columns'
import { everyRow } from './list-items'
import type { LiveView } from './live.svelte'
import { propertyName } from './words'

function viewCsv(live: LiveView): string | null {
  const base = live.base
  const answer = live.answer
  if (!base || !answer) return null
  const columns = live.columns.filter((one) => !isButton(one))
  const header = columns.map((one) => sheetSafe(propertyName(one, displayName(base, one))))
  const rows = everyRow(answer.groups).map((row) =>
    columns.map((column) => sheetSafe(csvValue(cellValue(base, column, row, live.context)))),
  )
  return csvText(header, rows)
}

export async function copyCsv(live: LiveView): Promise<void> {
  const csv = viewCsv(live)
  if (csv !== null) await copyText(csv)
}

export async function saveCsv(live: LiveView, name: string): Promise<void> {
  const csv = viewCsv(live)
  if (csv !== null) await deliver(name, 'csv', t('Spreadsheet'), { text: csv, mime: 'text/csv' })
}
