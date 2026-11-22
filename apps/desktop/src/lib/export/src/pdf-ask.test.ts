import { describe, expect, test, vi } from 'vitest'
import type { PageSetup } from '@orden/contracts'
import { memoryStorage } from '../../../../test/disk'

const ran = vi.hoisted(() => [] as { id: string; page: PageSetup | undefined }[])
vi.mock('./exporters', () => ({
  runExport: (id: string, _note: unknown, options: { page?: PageSetup }) => {
    ran.push({ id, page: options.page })
    return Promise.resolve(null)
  },
}))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../../workspace/src/api')
await import('../../workspace-ports')
const { choices } = await import('../../modes/src/api')
const { exportCommands } = await import('./commands')
const { pdfAsk } = await import('./pdf-ask.svelte')
const { previewOf } = await import('./pdf-preview')

const pdf = () => exportCommands().find((one) => one.id === 'export-pdf')
async function settled() {
  for (let round = 0; round < 20; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}
describe('exporting a note as PDF', () => {
  test('asks first, and Cancel writes nothing', async () => {
    workspace.openBlank('Plan.md', '# Plan\n')
    ran.length = 0
    pdf()?.run()
    expect(pdfAsk.open).toBe(true)
    pdfAsk.answer(false)
    await settled()
    expect(pdfAsk.open).toBe(false)
    expect(ran).toEqual([])
  })
  test('goes on with the page chosen in the dialog, and keeps it', async () => {
    workspace.openBlank('Plan.md', '# Plan\n')
    ran.length = 0
    pdf()?.run()
    choices.setPage({ paper: 'Letter', orientation: 'landscape', header: '${title}' })
    pdfAsk.answer(true)
    await settled()
    expect(ran).toEqual([{ id: 'pdf', page: expect.objectContaining({ paper: 'Letter', orientation: 'landscape' }) }])
    expect(JSON.parse(localStorage.getItem('orden:page') ?? '{}')).toMatchObject({
      paper: 'Letter',
      header: '${title}',
    })
  })
  test('asks nothing for the other formats', async () => {
    workspace.openBlank('Plan.md', '# Plan\n')
    ran.length = 0
    exportCommands()
      .find((one) => one.id === 'export-docx')
      ?.run()
    await settled()
    expect(pdfAsk.open).toBe(false)
    expect(ran.map((one) => one.id)).toEqual(['docx'])
  })
})
describe('the preview of the first page', () => {
  const html = '<html><head><style>@media print { a { color: red } }</style></head><body>@media print</body></html>'
  test('is the paper turned as chosen, and shows the page as it prints', () => {
    const shown = previewOf(html, { width: 8.5, height: 11, margin: 1, landscape: true })
    expect([shown.width, shown.height]).toEqual([1056, 816])
    expect(shown.html).toContain('@media all { a')
    expect(shown.html).toContain('padding: 1in')
    expect(shown.html).toContain('<body>@media print</body>')
  })
})
