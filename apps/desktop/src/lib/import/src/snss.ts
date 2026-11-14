interface SnssTab {
  url: string
  title: string
  pinned: boolean
  group: string | null
}

interface SnssWindow {
  tabs: SnssTab[]
}

export interface SnssSession {
  windows: SnssWindow[]
  groups: Map<string, string>
}

const SET_TAB_WINDOW = 0
const SET_TAB_INDEX_IN_WINDOW = 2
const TAB_NAVIGATION_PATH_PRUNED_FROM_BACK = 5
const UPDATE_TAB_NAVIGATION = 6
const SET_SELECTED_NAVIGATION_INDEX = 7
const SET_WINDOW_TYPE = 9
const TAB_NAVIGATION_PATH_PRUNED_FROM_FRONT = 11
const SET_PINNED_STATE = 12
const TAB_CLOSED = 16
const WINDOW_CLOSED = 17
const TAB_NAVIGATION_PATH_PRUNED = 24
const SET_TAB_GROUP = 25
const SET_TAB_GROUP_METADATA = 26
const SET_TAB_GROUP_METADATA_2 = 27

const SIGNATURE = [0x53, 0x4e, 0x53, 0x53]

const CLEAR = new Set([1, 3])

const NORMAL = 0

interface Tab {
  window: number | null
  index: number
  pinned: boolean
  group: string | null
  pages: Map<number, { url: string; title: string }>
  selected: number | null
}

export function readSnss(bytes: Uint8Array): SnssSession | 'locked' | null {
  if (bytes.length < 8 || SIGNATURE.some((byte, at) => bytes[at] !== byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!CLEAR.has(view.getInt32(4, true))) return 'locked'

  const tabs = new Map<number, Tab>()
  const types = new Map<number, number>()
  const order: number[] = []
  const closed = new Set<number>()
  const groups = new Map<string, string>()
  const tabOf = (id: number): Tab => {
    let tab = tabs.get(id)
    if (!tab) {
      tab = { window: null, index: 0, pinned: false, group: null, pages: new Map(), selected: null }
      tabs.set(id, tab)
    }
    return tab
  }
  const seen = (window: number) => {
    if (!order.includes(window)) order.push(window)
  }

  for (let at = 8; at + 2 <= bytes.length;) {
    const size = view.getUint16(at, true)
    at += 2
    if (size < 1 || at + size > bytes.length) break
    const id = bytes[at] ?? -1
    const said = new Reader(bytes.subarray(at + 1, at + size))
    at += size
    try {
      apply(id, said)
    } catch {
      // A command cut short or shaped otherwise says nothing; the rest still does.
    }
  }

  function apply(id: number, said: Reader) {
    switch (id) {
      case SET_TAB_WINDOW: {
        const window = said.int(0)
        tabOf(said.int(4)).window = window
        seen(window)
        return
      }
      case SET_TAB_INDEX_IN_WINDOW:
        tabOf(said.int(0)).index = said.int(4)
        return
      case TAB_NAVIGATION_PATH_PRUNED_FROM_BACK: {
        const tab = tabOf(said.int(0))
        const from = said.int(4)
        for (const index of [...tab.pages.keys()]) if (index >= from) tab.pages.delete(index)
        return
      }
      case TAB_NAVIGATION_PATH_PRUNED_FROM_FRONT: {
        const count = said.int(4)
        if (count > 0) prune(tabOf(said.int(0)), 0, count)
        return
      }
      case TAB_NAVIGATION_PATH_PRUNED: {
        const index = said.int(4)
        const count = said.int(8)
        if (index >= 0 && count > 0) prune(tabOf(said.int(0)), index, count)
        return
      }
      case UPDATE_TAB_NAVIGATION: {
        const pickle = said.pickle()
        const tab = tabOf(pickle.int())
        const index = pickle.int()
        const url = pickle.string()
        const title = pickle.string16()
        tab.pages.set(index, { url, title })
        return
      }
      case SET_SELECTED_NAVIGATION_INDEX:
        tabOf(said.int(0)).selected = said.int(4)
        return
      case SET_WINDOW_TYPE: {
        const window = said.int(0)
        types.set(window, said.int(4))
        seen(window)
        return
      }
      case SET_PINNED_STATE:
        tabOf(said.int(0)).pinned = said.byte(4) !== 0
        return
      case TAB_CLOSED:
        tabs.delete(said.int(0))
        return
      case WINDOW_CLOSED:
        closed.add(said.int(0))
        return
      case SET_TAB_GROUP:
        tabOf(said.int(0)).group = said.byte(24) !== 0 ? said.hex(8, 16) : null
        return
      case SET_TAB_GROUP_METADATA:
      case SET_TAB_GROUP_METADATA_2: {
        const pickle = said.pickle()
        const token = pickle.hex(16)
        groups.set(token, pickle.string16().trim())
        return
      }
    }
  }

  const windows = order
    .filter((window) => !closed.has(window) && (types.get(window) ?? NORMAL) === NORMAL)
    .map((window) => ({
      tabs: [...tabs.values()]
        .filter((tab) => tab.window === window)
        .sort((a, b) => a.index - b.index)
        .flatMap((tab): SnssTab[] => {
          const page = pageOf(tab)
          return page ? [{ ...page, pinned: tab.pinned, group: tab.group }] : []
        }),
    }))
    .filter((window) => window.tabs.length)

  return { windows, groups }
}

function prune(tab: Tab, from: number, count: number) {
  if (tab.selected !== null) {
    if (tab.selected >= from + count) tab.selected -= count
    else if (tab.selected >= from) tab.selected = from - 1
  }
  const pages = [...tab.pages].sort(([a], [b]) => a - b)
  tab.pages.clear()
  for (const [index, page] of pages) {
    if (index < from) tab.pages.set(index, page)
    else if (index >= from + count) tab.pages.set(index - count, page)
  }
}

function pageOf(tab: Tab): { url: string; title: string } | null {
  const indices = [...tab.pages.keys()].sort((a, b) => a - b)
  const { selected } = tab
  const chosen = selected === null ? undefined : indices.find((index) => index >= selected)
  const at = chosen ?? indices.at(-1)
  return at === undefined ? null : (tab.pages.get(at) ?? null)
}

class Reader {
  private readonly view: DataView

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  int(at: number): number {
    return this.view.getInt32(at, true)
  }

  byte(at: number): number {
    const one = this.bytes[at]
    if (one === undefined) throw new RangeError('cut short')
    return one
  }

  hex(at: number, length: number): string {
    if (at + length > this.bytes.length) throw new RangeError('cut short')
    return [...this.bytes.subarray(at, at + length)]
      .map((one) => one.toString(16).padStart(2, '0'))
      .join('')
  }

  pickle(): Pickle {
    return new Pickle(this.bytes.subarray(4))
  }
}

class Pickle {
  private readonly view: DataView
  private at = 0

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  int(): number {
    const one = this.view.getInt32(this.at, true)
    this.at += 4
    return one
  }

  hex(length: number): string {
    if (this.at + length > this.bytes.length) throw new RangeError('cut short')
    const out = [...this.bytes.subarray(this.at, this.at + length)]
      .map((one) => one.toString(16).padStart(2, '0'))
      .join('')
    this.at += padded(length)
    return out
  }

  string(): string {
    const length = this.int()
    if (length < 0 || this.at + length > this.bytes.length) throw new RangeError('cut short')
    const out = new TextDecoder().decode(this.bytes.subarray(this.at, this.at + length))
    this.at += padded(length)
    return out
  }

  string16(): string {
    const units = this.int()
    const length = units * 2
    if (units < 0 || this.at + length > this.bytes.length) throw new RangeError('cut short')
    const out = new TextDecoder('utf-16le').decode(this.bytes.subarray(this.at, this.at + length))
    this.at += padded(length)
    return out
  }
}

function padded(length: number): number {
  return Math.ceil(length / 4) * 4
}
