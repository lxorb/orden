import { isFileDrop } from './drag-paths'

export function guardDrops(): () => void {
  const over = (event: DragEvent) => {
    if (event.defaultPrevented || !isFileDrop(event.dataTransfer)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
  }

  const drop = (event: DragEvent) => {
    if (!event.defaultPrevented && isFileDrop(event.dataTransfer)) event.preventDefault()
  }

  window.addEventListener('dragover', over)
  window.addEventListener('drop', drop)

  return () => {
    window.removeEventListener('dragover', over)
    window.removeEventListener('drop', drop)
  }
}
