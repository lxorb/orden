import type { SyntaxNode } from '@lezer/common'
import { parser } from '@lezer/javascript'
import { backtracksWildly, patternJudge } from '@orden/markdown/pattern-cost'

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

const MADE_WILD = 'Orden makes no pattern that could take forever to match: it could not stop it'

const PATTERNS = `;(function () {
  var wild = (${patternJudge.toString()})().backtracksWildly
  var Native = RegExp
  var judging = false
  var own = function (where, name, value) {
    Object.defineProperty(where, name, { configurable: true, writable: true, value: value })
  }
  function check(source, flags) {
    if (judging) return
    judging = true
    var bad
    try {
      bad = wild(String(source), String(flags))
    } finally {
      judging = false
    }
    if (bad) throw new SyntaxError(${JSON.stringify(MADE_WILD)})
  }
  function made(pattern, flags) {
    var regex = pattern instanceof Native
    check(
      regex ? pattern.source : pattern === undefined ? '(?:)' : pattern,
      flags !== undefined ? flags : regex ? pattern.flags : '',
    )
  }
  function written(code) {
    if (typeof code !== 'string') return
    for (var at = code.indexOf('/'); at >= 0; at = code.indexOf('/', at + 1)) {
      var end = at + 1
      var inside = false
      for (; end < code.length && end - at < 4096; end++) {
        var one = code.charAt(end)
        if (one === '\\\\') end++
        else if (one === '\\n' || one === '\\r') break
        else if (one === '[') inside = true
        else if (one === ']') inside = false
        else if (one === '/' && !inside) break
      }
      if (code.charAt(end) !== '/') continue
      var body = code.slice(at + 1, end)
      var flags = /^[a-z]*/.exec(code.slice(end + 1, end + 9))[0]
      try {
        judging = true
        new Native(body, flags)
      } catch (error) {
        continue
      } finally {
        judging = false
      }
      check(body, flags)
    }
  }
  function Guarded(pattern, flags) {
    made(pattern, flags)
    return Reflect.construct(Native, [pattern, flags], new.target || Guarded)
  }
  Object.setPrototypeOf(Guarded, Native)
  Guarded.prototype = Native.prototype
  own(Native.prototype, 'constructor', Guarded)
  own(self, 'RegExp', Guarded)
  var compile = Native.prototype.compile
  if (compile) {
    own(Native.prototype, 'compile', function (pattern, flags) {
      made(pattern, flags)
      return compile.call(this, pattern, flags)
    })
  }
  ;['match', 'matchAll', 'search'].forEach(function (name) {
    var native = String.prototype[name]
    own(String.prototype, name, function (pattern) {
      if (pattern !== null && pattern !== undefined && !(pattern instanceof Native)) {
        check(pattern, name === 'matchAll' ? 'g' : '')
      }
      return native.apply(this, arguments)
    })
  })
  var evaluate = self.eval
  own(self, 'eval', function (code) {
    written(code)
    return evaluate(code)
  })
  ;[() => undefined, async () => undefined, function* () {}, async function* () {}].forEach(
    function (kind) {
      var prototype = Object.getPrototypeOf(kind)
      var Made = prototype.constructor
      var Checked = function () {
        written(Array.prototype.map.call(arguments, String).join('\\n'))
        return Reflect.construct(Made, arguments)
      }
      Checked.prototype = prototype
      own(prototype, 'constructor', Checked)
      if (prototype === Function.prototype) own(self, 'Function', Checked)
    },
  )
  ;['setTimeout', 'setInterval'].forEach(function (name) {
    var native = self[name]
    own(self, name, function (handler) {
      if (typeof handler !== 'function') written(String(handler))
      return native.apply(self, arguments)
    })
  })
})()`

const UNREAD = 'Orden could not read this script, so it does not run it'

const WILD =
  'Orden does not run a script with a pattern that could take forever to match: it could not stop it'

const MADE = new Set(['NewExpression', 'CallExpression'])

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
}

function written(literal: string): string | null {
  if (literal.startsWith('`') && literal.includes('${')) return null
  let out = ''
  try {
    for (let at = 1; at < literal.length - 1; at++) {
      const one = literal.charAt(at)
      if (one !== '\\') {
        out += one
        continue
      }
      const next = literal.charAt(++at)
      if (next === 'x') {
        out += String.fromCharCode(Number.parseInt(literal.slice(at + 1, at + 3), 16))
        at += 2
      } else if (next === 'u' && literal.charAt(at + 1) === '{') {
        const end = literal.indexOf('}', at)
        out += String.fromCodePoint(Number.parseInt(literal.slice(at + 2, end), 16))
        at = end
      } else if (next === 'u') {
        out += String.fromCharCode(Number.parseInt(literal.slice(at + 1, at + 5), 16))
        at += 4
      } else if (next === '\r' || next === '\n') {
        if (next === '\r' && literal.charAt(at + 1) === '\n') at++
      } else out += ESCAPES[next] ?? next
    }
  } catch {
    return null
  }
  return out
}

function patternMade(code: string, node: { node: SyntaxNode }): [string, string] | null {
  const callee = node.node.getChild('VariableName')
  if (callee === null || code.slice(callee.from, callee.to) !== 'RegExp') return null
  const args = node.node.getChild('ArgList')
  const first = args?.firstChild?.nextSibling
  if (!first || (first.name !== 'String' && first.name !== 'TemplateString')) return null
  const source = written(code.slice(first.from, first.to))
  if (source === null) return null
  const second = first.nextSibling?.nextSibling
  const flags =
    second && (second.name === 'String' || second.name === 'TemplateString')
      ? written(code.slice(second.from, second.to))
      : ''
  return [source, flags ?? '']
}

export function backtracks(code: string): boolean {
  let wild = false
  parser.parse(code).iterate({
    enter(node) {
      if (wild) return false
      if (node.name === 'RegExp') {
        const text = code.slice(node.from, node.to)
        const end = text.lastIndexOf('/')
        wild = backtracksWildly(text.slice(1, end), text.slice(end + 1))
      } else if (MADE.has(node.name)) {
        const made = patternMade(code, node)
        if (made) wild = backtracksWildly(...made)
      }
      return undefined
    },
  })
  return wild
}

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
    else if (backtracks(script.textContent)) refuse(script, WILD)
    else script.textContent = safe
  }
  const check = document.createElement('script')
  check.textContent = PRELUDE + PATTERNS
  holder.content.prepend(check)
  return holder.innerHTML
}
