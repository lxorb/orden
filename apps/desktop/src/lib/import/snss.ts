/** The file Chrome and every browser built on Chromium keep their open windows in:
 *  `Sessions/Session_<time>` in a profile, an SNSS file.
 *
 *  `SNSS`, a version as four little-endian bytes, and then commands: two bytes saying
 *  how long one is, a byte saying which it is, and what it says, most of them a fixed
 *  struct and the rest a base::Pickle (a length, then fields each padded to four
 *  bytes). The file is a log rather than a picture: the window is what replaying every
 *  command in order leaves, so a tab closed halfway through is gone and a tab moved is
 *  where it went. Read off Chromium's session_service_commands.cc and
 *  session_command.h; the numbers are the ones it has written since version 3, and a
 *  command not listed here is stepped over, since the file changes with its releases.
 *
 *  Versions 1 and 3 are written in the clear. Any other is not one this reads: newer
 *  Chromium writes `Sessions_Encrypted/` too, with a key that lives in the system's
 *  keychain, and those are said to be locked rather than read.
 *
 *  Pure: the bytes in, the windows out. */

/** One open tab: the page its history is on, and what is said of it. */
interface SnssTab {
  url: string
  title: string
  pinned: boolean
  /** The group it is in, by the group's token. */
  group: string | null
}

interface SnssWindow {
  tabs: SnssTab[]
}

export interface SnssSession {
  /** Only ordinary windows: never a popup's, an app's or the developer tools'. */
  windows: SnssWindow[]
  /** Each group's name by its token; an empty name is a group nobody named. */
  groups: Map<string, string>
}

/** The commands this reads, by Chromium's numbers. */
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

/** `SNSS`, as it opens the file. */
const SIGNATURE = [0x53, 0x4e, 0x53, 0x53]

/** The versions written in the clear. */
const CLEAR = new Set([1, 3])

/** The window type of an ordinary browser window. */
const NORMAL = 0

interface Tab {
  window: number | null
  index: number
  pinned: boolean
  group: string | null
  /** Each page of its history by its place in it. */
  pages: Map<number, { url: string; title: string }>
  selected: number | null
}

/** The windows a session file leaves, `locked` for one written encrypted, or null for
 *  bytes that are not a session at all. */
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
      // A tab's history cut: the pages after one it went back to and left for
      // another, or its oldest once it holds as many as Chromium keeps. Those after
      // the cut move down by as many as went, and the page it is on with them.
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

/** `count` pages of a tab's history cut from `from` on, as Chromium replays it: the
 *  pages after them take their places, and the page the tab is on moves with them,
 *  or to the one before the cut where it was one of those cut. */
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

/** The page a tab's history is on: the one it says it is on, or the first after
 *  it where that one is not kept, else its newest; which is how Chromium chooses. */
function pageOf(tab: Tab): { url: string; title: string } | null {
  const indices = [...tab.pages.keys()].sort((a, b) => a - b)
  const { selected } = tab
  const chosen = selected === null ? undefined : indices.find((index) => index >= selected)
  const at = chosen ?? indices.at(-1)
  return at === undefined ? null : (tab.pages.get(at) ?? null)
}

/** What a command says, read at fixed places or as a pickle. */
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

  /** `length` bytes from `at`, as hex: a group's token, which is only ever compared. */
  hex(at: number, length: number): string {
    if (at + length > this.bytes.length) throw new RangeError('cut short')
    return [...this.bytes.subarray(at, at + length)]
      .map((one) => one.toString(16).padStart(2, '0'))
      .join('')
  }

  /** The command as a pickle: past the length it opens with, read in order. */
  pickle(): Pickle {
    return new Pickle(this.bytes.subarray(4))
  }
}

/** A base::Pickle: each field padded out to four bytes. */
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

  /** A string of bytes, which is how a URL is written. */
  string(): string {
    const length = this.int()
    if (length < 0 || this.at + length > this.bytes.length) throw new RangeError('cut short')
    const out = new TextDecoder().decode(this.bytes.subarray(this.at, this.at + length))
    this.at += padded(length)
    return out
  }

  /** A string of UTF-16 units, which is how a title is written. */
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
