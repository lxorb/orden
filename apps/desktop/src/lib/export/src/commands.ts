import type { CommandExtension } from '@orden/contracts'
import {
  EXPORT_FORMATS,
  type Exportable,
  type ExportId,
  exportKindOf,
  isNoteFormat,
  labelOf,
  offeredBy,
  PANDOC_FORMATS,
} from '../../export-formats/src/api'
import { shortcuts } from '../../shortcuts/src/api'
import { busy } from '../../ui-kit/src/api'
import { settings } from '../../settings.svelte'
import { workspace } from '../../workspace/src/api'
import { TAB_KINDS } from '../../tab-kinds/src/api'
import { frontShut, openOut, openTarget, renderOptions } from './context'
import { picker } from './picker.svelte'

type Row = CommandExtension

export function exportCommands(): Row[] {
  if (__EVEN_PLUGIN__) return []

  const note = () => workspace.active
  const source = () => openTarget().source
  const name = () => note()?.name ?? 'Untitled.md'
  const shut = (rows: Row[]) =>
    frontShut() ? rows.map((one) => ({ ...one, disabled: true })) : rows

  const open = note()
  const kind = exportKindOf(
    open ? { exports: TAB_KINDS[open.kind].exports, path: open.path } : null,
  )

  const noteOut = async (id: Exportable) => {
    const m = await import('./exporters')
    const target = openTarget()
    await m.runExport(id, target, await renderOptions(target))
  }

  const drawingOut = async (id: ExportId) => {
    const picture = await import('../../plane/src/api')
    const drawing = picture.drawingOf(openOut())

    if (id === 'png') await picture.exportCanvasPng(drawing)
    else if (id === 'svg') await picture.exportCanvasSvg(drawing)
    else if (id === 'pdf') await picture.exportCanvasPdf(drawing)
  }

  const pagesOut = async (id: ExportId) => {
    const out = await (await import('../../pages/src/api')).pagesOut()
    const about = out.pagesOutOf(openOut())

    if (id === 'pdf') await out.exportPagesPdf(about)
    else if (id === 'png') await out.exportPagesPng(about)
    else if (id === 'svg') await out.exportPagesSvg(about)
  }

  const copyOut = async () => {
    const path = openTarget().path
    if (path === null) return

    const m = await import('../../files-out/src/api')
    await m.saveCopy(path, name())
  }

  const run = (id: ExportId) => () =>
    busy.start(
      'Exporting',
      async () => {
        if (kind === 'canvas') await drawingOut(id)
        else if (kind === 'pages') await pagesOut(id)
        else if (id === 'copy') await copyOut()
        else if (isNoteFormat(id)) await noteOut(id)
      },
      `export-${id}`,
    )

  const offered = offeredBy(kind)
  const nothing = offered.length === 0
  const asNote = kind === 'note' || nothing

  const commands: Row[] = (nothing ? offeredBy('note') : offered).map((id) => ({
    id: `export-${id}`,
    label: labelOf(id),
    hint: shortcuts.hint(`export.${id}`),
    disabled: nothing,
    run: run(id),
  }))

  if (asNote) {
    commands.push({
      id: 'page-setup',
      label: 'Page setup for export',
      run: () => settings.show('export'),
    })
  }

  if (!settings.pandoc || !asNote) return shut(commands)

  for (const format of PANDOC_FORMATS) {
    commands.push({
      id: `export-${format.id}`,
      label: `Export as ${format.label}`,
      disabled: nothing,
      run: () =>
        busy.start(
          'Exporting',
          async () => {
            const m = await import('./exporters')
            await m.exportPandoc(source(), name(), format.id, note()?.path ?? null)
          },
          `export-${format.id}`,
        ),
    })
  }

  return shut(commands)
}

export function exportPicker(): Row[] {
  if (__EVEN_PLUGIN__) return []

  const formats = exportCommands().filter((one) => one.id !== 'page-setup')

  return [
    {
      id: 'export',
      label: 'Export…',
      also: [
        ...formats.map((one) => one.label),
        ...[...EXPORT_FORMATS, ...PANDOC_FORMATS].map((one) => one.label),
      ],
      disabled: formats.every((one) => one.disabled === true),
      run: () => picker.show(),
    },
  ]
}
