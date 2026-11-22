import { type ChatsDemo, portOf } from '@orden/contracts'
import { EditorView } from '@orden/editor'
import { samePath } from '../../platform/src/api'
import { type Tab, workspace } from '../../workspace/src/api'
import { BEFORE, CHAT_NAME, chatAt, CREW, CREW_NAME, duringOf, PEOPLE, reactionsOf, REPLY, TIMES } from './chat'
import { phone, rest, shown, tabButton, until, type LoopScene } from './kit'
import { keysOf, type Move, PAUSE, typedAt } from './motion'
import { boxOf, type Pointer } from './pointer'
import { BASE, LAUNCH, ROOT } from './space'

interface Room {
  path: string
  tab: Tab
  ids: (string | null)[]
}
const compose = (text: string) => {
  const field = [...document.querySelectorAll<HTMLElement>('.cm-editor')].find(
    (one) => one.offsetParent && one.closest('form, .composer, footer'),
  )
  const view = field ? EditorView.findFromDOM(field) : null
  if (!view || view.state.doc.toString() === text) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
}
export function talkScene(you: () => Pointer): LoopScene {
  const reply = keysOf(REPLY, 63)
  const sent = TIMES.typing + reply.took + 700
  const during = duringOf(`${location.origin}${BASE}demo/lan-party.png`, sent)
  const reactions = reactionsOf(sent)
  let chats: ChatsDemo | null = null
  let crew: Room | null = null
  let ride: Room | null = null
  let talked = { said: 0, typing: null as string | null, reacted: 0 }
  let fresh = true
  let staging = false
  const [me, ...others] = PEOPLE
  const tabOf = (path: string) => until(() => workspace.tabs.find((one) => samePath(one.path, path)))
  const room = async (name: string, lines: typeof BEFORE, activate: boolean): Promise<Room | null> => {
    if (!chats) return null
    const path = chats.add(`${ROOT}/${LAUNCH}`, name, others)
    for (const one of lines) chats.say(path, one.from, one.body)
    chats.open(path, { activate })
    return { path, tab: await tabOf(path), ids: [] }
  }
  const restage = async () => {
    if (staging) return
    staging = true
    try {
      const old = ride
      ride = await room(CHAT_NAME, BEFORE, false)
      talked = { said: 0, typing: null, reacted: 0 }
      if (old) workspace.closeEach([old.tab.id])
      if (crew) workspace.activate(crew.tab.id)
    } finally {
      staging = false
    }
  }
  return {
    period: TIMES.end,
    still: 0,
    ready: async () => {
      const port = portOf('chats.demo')
      if (!port.ok) return
      chats = await port.value.stage(me)
      crew = await room(CREW_NAME, CREW, true)
      await restage()
    },
    tick: (phase) => {
      const ms = phase * TIMES.end
      const inside = ms >= TIMES.open && ms < TIMES.back
      const showing = inside ? ride : crew
      if (showing && !staging && workspace.activeTabId !== showing.tab.id) workspace.activate(showing.tab.id)
      if (!inside && ms >= TIMES.back + 900 && !fresh) {
        fresh = true
        void restage()
      }
      if (inside) fresh = false
      const composer = () => boxOf('.cm-editor .cm-content')
      const moves: Move[] = [
        { at: 0, to: rest },
        ...(phone() ? [] : [{ at: TIMES.open - PAUSE, to: tabButton(() => ride?.tab ?? null), press: true }]),
        { at: TIMES.open + 1400, to: rest },
        { at: TIMES.composer - 1200, to: rest },
        { at: TIMES.composer - PAUSE, to: composer, press: true },
        { at: sent - 1300, to: composer },
        { at: sent - PAUSE, to: () => boxOf('button[aria-label="Send"]'), press: true },
        { at: sent + 1400, to: rest },
        { at: TIMES.back - 1500, to: rest },
        ...(phone() ? [] : [{ at: TIMES.back - PAUSE, to: tabButton(() => crew?.tab ?? null), press: true }]),
        { at: TIMES.back + 1300, to: rest },
      ]
      shown(you(), ms, moves)
      if (!inside || !ride || !chats || staging) return
      compose(ms < TIMES.typing || ms >= sent ? '' : typedAt(reply, ms - TIMES.typing))
      const now = chatAt(ms, during, reactions)
      if (now.typing !== talked.typing) {
        if (talked.typing) chats.typing(ride.path, talked.typing, false)
        if (now.typing) chats.typing(ride.path, now.typing, true)
      }
      for (let at = talked.said; at < now.said; at++) {
        const line = during[at]
        if (!line) continue
        ride.ids[at] = line.picture
          ? chats.picture(ride.path, line.from, line.picture, {
              width: 320,
              height: 200,
              name: 'lan-party.png',
              caption: line.body,
            })
          : chats.say(ride.path, line.from, line.body)
      }
      for (let at = talked.reacted; at < now.reacted; at++) {
        const one = reactions[at]
        const id = one ? ride.ids[one.line] : null
        if (one && id) chats.react(ride.path, id, one.from, one.emoji)
      }
      talked = now
    },
  }
}
