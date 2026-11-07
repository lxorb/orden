interface Asked {
  id: number
  picture: ImageBitmap
  as?: 'data' | 'bytes'
}

async function encoded(
  picture: ImageBitmap,
  as: Asked['as'],
): Promise<string | ArrayBuffer | null> {
  const canvas = new OffscreenCanvas(picture.width, picture.height)
  const drawing = canvas.getContext('2d')
  if (!drawing) return null
  drawing.drawImage(picture, 0, 0)
  picture.close()
  const png = await canvas.convertToBlob({ type: 'image/png' })
  if (as === 'bytes') return png.arrayBuffer()
  return new Promise((done) => {
    const reader = new FileReader()
    reader.onload = () => done(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => done(null)
    reader.readAsDataURL(png)
  })
}

self.onmessage = (event: MessageEvent<Asked>) => {
  const { id, picture, as } = event.data
  encoded(picture, as).then(
    (png) => self.postMessage({ id, png }, { transfer: png instanceof ArrayBuffer ? [png] : [] }),
    () => self.postMessage({ id, png: null }),
  )
}
