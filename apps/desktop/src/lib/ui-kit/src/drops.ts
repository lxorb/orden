import { isFileDrop, listenOver, outsideRows } from './drag-paths'

const PDF = /\.pdf$/i

function pdfsOf(transfer: DataTransfer | null): string[] {
  return outsideRows(transfer).filter((one) => PDF.test(one))
}

export function guardDrops(opened: (paths: readonly string[]) => void): () => void {
  let ours = false

  const over = (event: DragEvent) => {
    ours = false
    if (event.defaultPrevented) return

    const pdfs = pdfsOf(event.dataTransfer).length > 0
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
    const pdfs = pdfsOf(event.dataTransfer)
    if (pdfs.length) opened(pdfs)
  }

  const drop = (event: DragEvent) => {
    if (!event.defaultPrevented && isFileDrop(event.dataTransfer)) event.preventDefault()
  }

  const unheard = listenOver(window, over)
  window.addEventListener('drop', taken, true)
  window.addEventListener('drop', drop)

  return () => {
    unheard()
    window.removeEventListener('drop', taken, true)
    window.removeEventListener('drop', drop)
  }
}
