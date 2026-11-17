export const PICTURES = 'image/*,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.bmp'

const SAME_ASKING = 1000

interface Asking {
  accept?: string
  multiple?: boolean
  camera?: boolean
  folder?: boolean
}

let asked: { at: number; files: Promise<File[]> } | null = null

export function chooseFiles(asking: Asking = {}): Promise<File[]> {
  if (typeof document === 'undefined') return Promise.resolve([])

  const now = performance.now()
  if (asked && now - asked.at < SAME_ASKING) return asked.files

  const files = opened(asking)
  const mine = { at: now, files }
  asked = mine
  void files.then(() => {
    if (asked === mine) asked = null
  })
  return files
}

function opened({ accept, multiple = false, camera = false, folder = false }: Asking) {
  return new Promise<File[]>((settle) => {
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
