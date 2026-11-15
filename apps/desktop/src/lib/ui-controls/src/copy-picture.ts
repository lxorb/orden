export async function copyPicture(url: string): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(url) })])
}

async function pngOf(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`)

  const blob = await response.blob()
  return blob.type === 'image/png' ? blob : drawn(blob)
}

async function drawn(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext('2d')?.drawImage(image, 0, 0)

    return await new Promise((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png)
        else reject(new Error('the picture could not be drawn'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
