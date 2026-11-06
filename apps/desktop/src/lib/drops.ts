import { carried, explorerDragged, isExplorerDrag, isFileDrop, isTreeDrag } from './drag-paths'

const PDF = /\.pdf$/i

function isPdfPath(path: string): boolean {
  return PDF.test(path)
}

function outsideRows(transfer: DataTransfer | null): readonly string[] {
  if (!isExplorerDrag(transfer) || isTreeDrag(transfer)) return []

  const rows = explorerDragged(transfer)
  return rows.length ? rows : carried()
}

function mayHoldPdfs(transfer: DataTransfer | null): boolean {
  const rows = outsideRows(transfer)
  if (rows.length) return rows.some(isPdfPath)
  if (!isFileDrop(transfer)) return false

  const files = [...(transfer?.items ?? [])].filter((one) => one.kind === 'file')
  return !files.length || files.some((one) => one.type === 'application/pdf' || one.type === '')
}

export function guardDrops(
  opened: (paths: readonly string[]) => void = (paths) => void openPdfs(paths),
): () => void {
  let ours = false

  const over = (event: DragEvent) => {
    ours = false
    if (event.defaultPrevented) return

    const pdfs = mayHoldPdfs(event.dataTransfer)
    if (!pdfs && !isFileDrop(event.dataTransfer)) return

    event.preventDefault()
    ours = pdfs
    if (event.dataTransfer) event.dataTransfer.dropEffect = pdfs ? 'copy' : 'none'
  }

  const taken = (event: DragEvent) => {
    if (!ours) return

    ours = false
    event.preventDefault()
    event.stopImmediatePropagation()
    const transfer = event.dataTransfer
    const rows = outsideRows(transfer)
    const files = [...(transfer?.files ?? [])]
    void (rows.length ? Promise.resolve(rows) : pathsOf(files)).then((paths) => {
      const pdfs = paths.filter(isPdfPath)
      if (pdfs.length) opened(pdfs)
    })
  }

  const drop = (event: DragEvent) => {
    if (!event.defaultPrevented && isFileDrop(event.dataTransfer)) event.preventDefault()
  }

  window.addEventListener('dragover', over)
  window.addEventListener('drop', taken, true)
  window.addEventListener('drop', drop)

  return () => {
    window.removeEventListener('dragover', over)
    window.removeEventListener('drop', taken, true)
    window.removeEventListener('drop', drop)
  }
}

async function openPdfs(paths: readonly string[]) {
  const { showPdfs } = await import('./pdf/handed')
  await showPdfs(paths)
}

async function pathsOf(files: readonly File[]): Promise<readonly string[]> {
  if (!files.length) return []
  const { droppedPaths } = await import('./dropped-paths')
  return droppedPaths(files)
}
