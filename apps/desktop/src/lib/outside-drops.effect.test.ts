import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const handed = vi.hoisted(() => ({ paths: [] as string[], asked: [] as string[][] }))

vi.mock('./dropped-paths', () => ({
  droppedPaths: (files: readonly File[]) => {
    handed.asked.push(files.map((one) => one.name))
    return Promise.resolve(handed.paths)
  },
}))

class Transfer {
  kept = new Map<string, string>()
  held: File[] = []

  ignored: string[] = []

  get dropEffect() {
    return 'none'
  }

  set dropEffect(value: string) {
    this.ignored.push(value)
  }

  get effectAllowed() {
    return 'uninitialized'
  }

  set effectAllowed(value: string) {
    this.ignored.push(value)
  }

  get types() {
    return [...this.kept.keys(), ...(this.held.length ? ['Files'] : [])]
  }

  get files() {
    return this.held
  }

  get items() {
    const all = [
      ...[...this.kept.keys()].map((type) => ({ kind: 'string', type })),
      ...this.held.map((one) => ({ kind: 'file', type: one.type })),
    ]
    return Object.assign(all, { add: (file: File) => void this.held.push(file) })
  }

  setData(type: string, value: string) {
    this.kept.set(type, value)
  }

  getData(type: string) {
    return this.kept.get(type) ?? ''
  }
}

class Native extends Transfer {
  effect = 'none'

  override get dropEffect() {
    return this.effect
  }

  override set dropEffect(value: string) {
    this.effect = value
  }
}

class Drag extends MouseEvent {
  dataTransfer: Transfer | null

  constructor(type: string, init: MouseEventInit & { dataTransfer?: Transfer } = {}) {
    super(type, { ...init, view: null })
    this.dataTransfer = init.dataTransfer ?? null
  }
}

Object.assign(globalThis, { DataTransfer: Transfer, DragEvent: Drag })

const { guardDrops } = await import('./drops')
const { filesAt, OutsideDrops } = await import('./outside-drops')
const { explorerDragged, isExplorerDrag } = await import('./drag-paths')

let under: Element | null = null
let opened: string[][] = []
let read: string[] = []
let heard: string[] = []
let stop: () => void = () => undefined

function place(id: string): HTMLElement {
  const one = document.createElement('div')
  one.id = id
  document.body.append(one)
  return one
}

function drops() {
  return new OutsideDrops({
    read: (path) => {
      read.push(path)
      return Promise.resolve(new TextEncoder().encode(`bytes of ${path}`))
    },
    ratio: () => 2,
  })
}

function hearing(on: HTMLElement) {
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    on.addEventListener(type, (event) => {
      const transfer = (event as Drag).dataTransfer
      const at = `${(event as Drag).clientX},${(event as Drag).clientY}`
      heard.push(`${type} ${on.id} ${at} ${transfer?.types.join('+') ?? ''}`)
    })
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  under = null
  opened = []
  read = []
  heard = []
  handed.paths = []
  handed.asked = []
  document.elementFromPoint = () => under
  stop = guardDrops((paths) => void opened.push([...paths]))
})

afterEach(() => stop())

const at = { x: 40, y: 60 }

describe('a file dropped on Orden from another app, as Linux hands it over', () => {
  test('a PDF let go of where nothing takes files opens as a page note, its bytes unread', async () => {
    under = place('pane')
    hearing(under as HTMLElement)
    const outside = drops()

    outside.entered({ paths: ['/far/paper.pdf'], position: at })
    outside.moved({ position: at })
    await outside.dropped({ paths: ['/far/paper.pdf'], position: at })
    await vi.waitFor(() => expect(opened).toEqual([['/far/paper.pdf']]))

    expect(read).toEqual([])
    expect(heard[0]).toBe('dragenter pane 20,30 text/orden-explorer+Files')
    expect(heard.some((one) => one.startsWith('drop'))).toBe(false)
  })

  test('the file list takes it by its path and nothing is read or opened', async () => {
    const list = place('list')
    under = list
    const landed: string[][] = []
    list.addEventListener('dragover', (event) => {
      const transfer = (event as Drag).dataTransfer as unknown as DataTransfer
      if (!isExplorerDrag(transfer)) return
      event.preventDefault()
      transfer.dropEffect = 'copy'
    })
    list.addEventListener('drop', (event) => {
      const transfer = (event as Drag).dataTransfer as unknown as DataTransfer
      if (!isExplorerDrag(transfer)) return
      event.preventDefault()
      landed.push(explorerDragged(transfer))
    })
    const outside = drops()

    outside.entered({ paths: ['/far/paper.pdf', '/far/notes'], position: at })
    await outside.dropped({ position: at })

    expect(landed).toEqual([['/far/paper.pdf', '/far/notes']])
    expect(read).toEqual([])
    expect(opened).toEqual([])
  })

  test('a place that takes files is handed them with their bytes', async () => {
    const editor = place('editor')
    under = editor
    const taken: string[] = []
    editor.addEventListener('dragover', (event) => {
      const transfer = (event as Drag).dataTransfer!
      if ([...transfer.items].some((one) => one.kind === 'file' && one.type !== 'application/pdf'))
        event.preventDefault()
    })
    editor.addEventListener('drop', (event) => {
      const files = (event as Drag).dataTransfer?.files ?? []
      if (!files.length) return
      event.preventDefault()
      for (const one of files) taken.push(`${one.name} ${one.type} ${one.size}`)
    })
    const outside = drops()

    outside.entered({ paths: ['/far/cat.png'], position: at })
    await outside.dropped({ position: at })

    expect(read).toEqual(['/far/cat.png'])
    expect(taken).toEqual([`cat.png image/png ${'bytes of /far/cat.png'.length}`])
    expect(opened).toEqual([])
  })

  test('a PDF on a note goes past the note, which takes pictures, and opens', async () => {
    const editor = place('editor')
    under = editor
    editor.addEventListener('dragover', (event) => {
      const transfer = (event as Drag).dataTransfer!
      if ([...transfer.items].some((one) => one.kind === 'file' && one.type !== 'application/pdf'))
        event.preventDefault()
    })
    const outside = drops()

    outside.entered({ paths: ['/far/paper.pdf'], position: at })
    await outside.dropped({ position: at })

    await vi.waitFor(() => expect(opened).toEqual([['/far/paper.pdf']]))
    expect(read).toEqual([])
  })

  test('another kind of file where nothing takes it is refused and left alone', async () => {
    under = place('pane')
    hearing(under as HTMLElement)
    const outside = drops()

    outside.entered({ paths: ['/far/song.mp3'], position: at })
    await outside.dropped({ position: at })

    expect(opened).toEqual([])
    expect(read).toEqual([])
    expect(heard.some((one) => one.startsWith('drop'))).toBe(false)
    expect(heard.at(-1)).toMatch(/^dragleave pane/)
  })

  test('a drag that leaves the window says so to what it was over', () => {
    under = place('pane')
    hearing(under as HTMLElement)
    const outside = drops()

    outside.entered({ paths: ['/far/paper.pdf'], position: at })
    outside.left()

    expect(heard.at(-1)).toMatch(/^dragleave pane/)
    expect(opened).toEqual([])
  })

  test('moving on says dragleave to the one left and dragenter to the one reached', () => {
    const one = place('one')
    const two = place('two')
    hearing(one)
    hearing(two)
    under = one
    const outside = drops()

    outside.entered({ paths: ['/far/paper.pdf'], position: at })
    under = two
    outside.moved({ position: { x: 80, y: 60 } })

    expect(heard.filter((said) => !said.startsWith('dragover'))).toEqual([
      'dragenter one 20,30 text/orden-explorer+Files',
      'dragenter two 40,30 text/orden-explorer+Files',
      'dragleave one 40,30 text/orden-explorer+Files',
    ])
  })
})

describe('a file dropped on Orden from another app, as WebView2 and WebKit hand it over', () => {
  function native(type: string, on: Element, files: File[]): Drag {
    const transfer = new Native()
    for (const one of files) transfer.items.add(one)
    transfer.dropEffect = 'copy'
    const event = new Drag(type, { bubbles: true, cancelable: true, dataTransfer: transfer })
    on.dispatchEvent(event)
    return event
  }

  test('a PDF nothing takes is let in and opened from where it lies', async () => {
    const pane = place('pane')
    const paper = new File(['%PDF-'], 'paper.pdf', { type: 'application/pdf' })
    handed.paths = ['C:\\far\\paper.pdf']

    const over = native('dragover', pane, [paper])
    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer?.dropEffect).toBe('copy')
    native('drop', pane, [paper])

    await vi.waitFor(() => expect(opened).toEqual([['C:\\far\\paper.pdf']]))
    expect(handed.asked).toEqual([['paper.pdf']])
  })

  test('another kind of file nothing takes is refused', () => {
    const pane = place('pane')
    const song = new File(['ID3'], 'song.mp3', { type: 'audio/mpeg' })

    const over = native('dragover', pane, [song])

    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer?.dropEffect).toBe('none')
  })

  test('a PDF a place takes for itself is left to it', () => {
    const canvas = place('canvas')
    const paper = new File(['%PDF-'], 'paper.pdf', { type: 'application/pdf' })
    let dropped = 0
    canvas.addEventListener('dragover', (event) => event.preventDefault())
    canvas.addEventListener('drop', (event) => {
      event.preventDefault()
      dropped++
    })

    native('dragover', canvas, [paper])
    native('drop', canvas, [paper])

    expect(dropped).toBe(1)
    expect(handed.asked).toEqual([])
    expect(opened).toEqual([])
  })
})

describe('files read for a place that takes them by their paths', () => {
  test('are named and typed by their paths, and one that cannot be read is left out', async () => {
    const read = (path: string) =>
      path.endsWith('gone.png')
        ? Promise.reject(new Error('gone'))
        : Promise.resolve(new Uint8Array([1, 2]))
    const files = await filesAt(['/home/me/a.png', '/home/me/gone.png', '/home/me/b.pdf'], read)
    expect(files.map((one) => [one.name, one.type, one.size])).toEqual([
      ['a.png', 'image/png', 2],
      ['b.pdf', 'application/pdf', 2],
    ])
  })
})
