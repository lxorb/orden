export const PICTURES = 'image/*,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.bmp'

interface Asking {
  accept?: string
  multiple?: boolean
  camera?: boolean
  folder?: boolean
}

export function chooseFiles(asking: Asking = {}): Promise<File[]> {
  if (typeof document === 'undefined') return Promise.resolve([])

  const { accept, multiple = false, camera = false, folder = false } = asking

  return new Promise((settle) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept !== undefined) input.accept = accept
    input.multiple = multiple
    if (camera) input.capture = 'environment'
    input.webkitdirectory = folder
    input.style.position = 'fixed'
    input.style.left = '-1000px'
    input.style.opacity = '0'

    let answered = false
    const answer = (files: File[]) => {
      if (answered) return

      answered = true
      input.remove()
      settle(files)
    }

    input.addEventListener('change', () => answer([...(input.files ?? [])]))
    input.addEventListener('cancel', () => answer([]))

    document.body.append(input)
    input.click()
  })
}
