/** A block of a note's own HTML, with every loop in its scripts made to give up (#525).
 *
 *  A block's scripts run in a sandboxed frame, because they need its document. In
 *  Chromium such a frame is a process of its own; in WebKit - a Mac, an iPhone, Safari -
 *  it shares the app's thread, and a script that never gives its task back froze the
 *  whole app for good: nothing can stop code that is not asking to be stopped from the
 *  thread it is running on. So the loops are asked. Each one checks, as it goes round,
 *  how long the task it is in has been running, and leaves once that is past
 *  `LOOP_LIMIT`: the block is stopped where it was, and says so on its console.
 *
 *  A ` ```js ` fence needs none of this: it has no document to want, so it runs in a
 *  worker, which is a thread of its own everywhere (run/protocol.ts). A loop is what an
 *  endless block is in practice; a block that sets out to hang its reader can still find
 *  another way - `eval` of a string, a regular expression that never finishes - and
 *  what stops it is still that nothing runs before the card is pressed. */

import { parser } from '@lezer/javascript'

/** How long one task of a block may go round its loops, in milliseconds: far past
 *  anything a block draws with, and short enough that a reader sees a pause rather
 *  than a frozen app. */
export const LOOP_LIMIT = 3000

/** What a loop asks: whether to leave. A name a block would never use, defined so it
 *  cannot be replaced. */
const SPIN = '__nibSpin'

/** The loops of the grammar, and where each one's body is among its children. */
const LOOPS = new Set(['ForStatement', 'WhileStatement', 'DoStatement'])

/** `code` with a check at the top of every loop's body, or the code as it is where it
 *  does not parse: then it throws when it runs, which no loop survives. */
export function guarded(code: string): string {
  const tree = parser.parse(code)
  const edits: { at: number; text: string }[] = []
  // Said on the walk below: a tree with an error in it, or a loop with no body.
  const found = { broken: false }

  tree.iterate({
    enter(node) {
      if (node.type.isError) found.broken = true
      if (!LOOPS.has(node.name)) return

      const body =
        node.name === 'DoStatement' ? node.node.firstChild?.nextSibling : node.node.lastChild
      if (!body) {
        found.broken = true
        return
      }
      if (body.name === 'Block') {
        edits.push({ at: body.from + 1, text: `if(${SPIN}())break;` })
      } else {
        edits.push({ at: body.from, text: `{if(${SPIN}())break;` })
        edits.push({ at: body.to, text: '}' })
      }
    },
  })

  if (found.broken || !edits.length) return code

  let out = code
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, edit.at) + edit.text + out.slice(edit.at)
  }
  return out
}

/** The check every loop makes, run first in the frame. The task is timed from the first
 *  check in it, and a message to itself - which arrives only once the task has given
 *  the thread back - starts the next one afresh. A promise that keeps queueing promises
 *  never gives it back either, so a loop of awaits is timed as the one task it is. */
const PRELUDE = `;(function () {
  var since = 0
  var armed = false
  var told = false
  var count = 0
  var next = new MessageChannel()
  next.port1.onmessage = function () {
    armed = false
    told = false
  }
  Object.defineProperty(globalThis, '${SPIN}', {
    value: function () {
      if (!armed) {
        armed = true
        since = performance.now()
        next.port2.postMessage(0)
      }
      if ((++count & 255) !== 0 || performance.now() - since < ${LOOP_LIMIT}) return false
      if (!told) {
        told = true
        console.error('Orden stopped a loop that ran for ${LOOP_LIMIT / 1000} s')
      }
      return true
    },
  })
})()`

/** What a script's type makes of it, as frame-script.js reads it: code, or data. */
function runs(script: HTMLScriptElement): boolean {
  const type = (script.getAttribute('type') ?? '').trim().toLowerCase()
  return (
    !script.hasAttribute('src') &&
    (type === '' ||
      type === 'module' ||
      /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/.test(type))
  )
}

/** A block of a note's own HTML, its scripts guarded and the check put in front of
 *  them. The block as it is where it runs no script. Read in a template, where nothing
 *  in it runs or loads. */
export function guardedBlock(html: string): string {
  const holder = document.createElement('template')
  holder.innerHTML = html
  const scripts = [...holder.content.querySelectorAll('script')].filter(runs)
  if (!scripts.length) return html

  for (const script of scripts) script.textContent = guarded(script.textContent)
  const check = document.createElement('script')
  check.textContent = PRELUDE
  holder.content.prepend(check)
  return holder.innerHTML
}
