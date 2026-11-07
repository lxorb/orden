import { parser } from '@lezer/javascript'

export const LOOP_LIMIT = 3000

const SPIN = '__nibSpin'

const LOOPS = new Set(['ForStatement', 'WhileStatement', 'DoStatement'])

export function guarded(code: string): string | null {
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

  if (found.broken) return null
  if (!edits.length) return code

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

const UNREAD = 'Orden could not read this script, so it does not run it'

const ELSEWHERE =
  'Orden does not run a script from elsewhere in a block: it could not stop one that never ends'

const ADDRESSES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data'])

function runs(script: HTMLScriptElement): boolean {
  const type = (script.getAttribute('type') ?? '').trim().toLowerCase()
  if (type === 'module') return true
  if (script.hasAttribute('nomodule')) return false
  return type === '' || /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/.test(type)
}

function refuse(script: HTMLScriptElement, why: string) {
  script.removeAttribute('src')
  script.textContent = `console.error(${JSON.stringify(why)})`
}

function scripted(attribute: Attr): boolean {
  const name = attribute.name.toLowerCase()
  if (name.startsWith('on')) return true
  if (!ADDRESSES.has(name)) return false
  let written = ''
  for (let at = 0; at < attribute.value.length && written.length < 11; at++) {
    if (attribute.value.charCodeAt(at) > 32) written += attribute.value.charAt(at)
  }
  return written.toLowerCase() === 'javascript:'
}

function unhandled(root: DocumentFragment): boolean {
  let changed = false
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (!scripted(attribute)) continue
      element.removeAttribute(attribute.name)
      changed = true
    }
  }
  return changed
}

export function guardedBlock(html: string): string {
  const holder = document.createElement('template')
  holder.innerHTML = html
  const changed = unhandled(holder.content)
  const scripts = [...holder.content.querySelectorAll('script')].filter(runs)
  if (!scripts.length) return changed ? holder.innerHTML : html

  for (const script of scripts) {
    if (script.hasAttribute('src')) {
      refuse(script, ELSEWHERE)
      continue
    }
    const safe = guarded(script.textContent)
    if (safe === null) refuse(script, UNREAD)
    else script.textContent = safe
  }
  const check = document.createElement('script')
  check.textContent = PRELUDE
  holder.content.prepend(check)
  return holder.innerHTML
}
