interface Asked {
  id: number
  picture: ImageBitmap
}

async function encoded(picture: ImageBitmap): Promise<string | null> {
  const canvas = new OffscreenCanvas(picture.width, picture.height)
  const drawing = canvas.getContext('2d')
  if (!drawing) return null
  drawing.drawImage(picture, 0, 0)
  picture.close()
  const png = await canvas.convertToBlob({ type: 'image/png' })
  return new Promise((done) => {
    const reader = new FileReader()
    reader.onload = () => done(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => done(null)
    reader.readAsDataURL(png)
  })
}

self.onmessage = (event: MessageEvent<Asked>) => {
  const { id, picture } = event.data
  encoded(picture).then(
    (png) => self.postMessage({ id, png }),
    () => self.postMessage({ id, png: null }),
  )
}
