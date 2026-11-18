import { expect, test } from 'vitest'
import { exporters, frontShut, loadExportSheet, picker, printNote } from '../src/api'

test('the module stands on its own the api loads with the sheet closed and every door a function', () => {
  expect(picker.open).toBe(false)
  for (const one of [frontShut, printNote, exporters, loadExportSheet]) {
    expect(typeof one).toBe('function')
  }
})

test('the exporters behind their door name every exporter the shell reaches', async () => {
  const kit = await exporters()
  for (const one of [kit.runExport, kit.exportPandoc]) {
    expect(typeof one).toBe('function')
  }
})
