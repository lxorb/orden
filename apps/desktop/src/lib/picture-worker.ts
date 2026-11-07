import { dataUrlOf, offscreenSheet, redrawn, sheetDrawing } from './feedback-pictures'

interface Asked {
  id: number
  file: Blob
}

function drawsHere(): boolean {
  try {
    return (
      typeof createImageBitmap === 'function' &&
      typeof OffscreenCanvas === 'function' &&
      !!new OffscreenCanvas(1, 1).getContext('2d')
    )
  } catch {
    return false
  }
}

const able = drawsHere()

self.onmessage = (event: MessageEvent<Asked>) => {
  const { id, file } = event.data
  if (!able) {
    self.postMessage({ id, unable: true })
    return
  }
  redrawn(file, sheetDrawing(offscreenSheet))
    .then((drawn) => (drawn ? dataUrlOf(drawn.blob, drawn.type) : null))
    .then(
      (dataUrl) => self.postMessage({ id, dataUrl }),
      () => self.postMessage({ id, dataUrl: null }),
    )
}
