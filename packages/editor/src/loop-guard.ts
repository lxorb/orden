import { parser } from '@lezer/javascript'

export const LOOP_LIMIT = 3000

const SPIN = '__nibSpin'

const LOOPS = new Set(['ForStatement', 'WhileStatement', 'DoStatement'])

export function guarded(code: string): string {
  const tree = parser.parse(code)
  const edits: { at: number; text: string }[] = []
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

const PRELUDE = `;(function () {
  var since = 0
  var armed = false
  var stopped = false
  var count = 0
  var next = new MessageChannel()
  next.port1.onmessage = function () {
    armed = false
    stopped = false
  }
  Object.defineProperty(globalThis, '${SPIN}', {
    value: function () {
      if (!armed) {
        armed = true
        since = performance.now()
        next.port2.postMessage(0)
      }
      if (stopped) return true
      if ((++count & 255) !== 0 || performance.now() - since < ${LOOP_LIMIT}) return false
      stopped = true
      console.error('Orden stopped a loop that ran for ${LOOP_LIMIT / 1000} s')
      return true
    },
  })
})()`

function runs(script: HTMLScriptElement): boolean {
  const type = (script.getAttribute('type') ?? '').trim().toLowerCase()
  return (
    !script.hasAttribute('src') &&
    (type === '' ||
      type === 'module' ||
      /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/.test(type))
  )
}

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
