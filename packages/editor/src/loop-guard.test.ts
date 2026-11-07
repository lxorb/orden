// @vitest-environment jsdom
import { createContext, runInContext } from 'node:vm'
import { describe, expect, test, vi } from 'vitest'
import { backtracks, guarded, guardedBlock, LOOP_LIMIT } from './loop-guard'

function compiled(...parts: string[]): (...args: unknown[]) => unknown {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the guarded code is what is under test
  return new Function(...parts) as (...args: unknown[]) => unknown
}

function runs(code: string, rounds = 5): number {
  let asked = 0
  const spin = () => ++asked > rounds
  compiled('__ordenSpin', guarded(code) ?? '')(spin)
  return asked
}

describe('a loop in a block', () => {
  test('of every kind leaves when it is told to', () => {
    expect(runs('while (true) {}')).toBe(6)
    expect(runs('for (;;) {}')).toBe(6)
    expect(runs('do {} while (true)')).toBe(6)
    expect(runs('const o = { a: 1 }\nfor (;;) for (const k in o) {}')).toBeGreaterThan(5)
    expect(runs('outer: while (true) while (true) continue outer')).toBeGreaterThan(5)
  })

  test('without braces, as one statement', () => {
    expect(runs('let i = 0\nwhile (true) i++')).toBe(6)
    expect(runs('let i = 0\nif (true) while (true) i++\nelse i--')).toBe(6)
  })

  test('that ends by itself does what it did', () => {
    let total = 0
    const add = (n: number) => (total += n)
    compiled(
      '__ordenSpin',
      'add',
      guarded('for (let i = 1; i <= 4; i++) add(i)') ?? '',
    )(() => false, add)
    expect(total).toBe(10)
  })

  test('cannot be guarded where the code does not parse, and is left as written where it holds none', () => {
    expect(guarded('while (')).toBeNull()
    expect(guarded('const a = 1')).toBe('const a = 1')
  })

  test('in a string or a comment is not a loop', () => {
    const code = "const s = 'while (true) {}' // for (;;) {}"
    expect(guarded(code)).toBe(code)
  })
})

describe('a block of a note’s own HTML', () => {
  test('gets the check ahead of its scripts, and guarded scripts', () => {
    const html = '<div id="dial">x</div>\n<script>while (true) {}</script>'
    const out = guardedBlock(html)
    const holder = document.createElement('template')
    holder.innerHTML = out
    const scripts = [...holder.content.querySelectorAll('script')].map((one) => one.textContent)

    expect(scripts).toHaveLength(2)
    expect(scripts[0]).toContain("defineProperty(globalThis, '__ordenSpin'")
    expect(scripts[1]).toBe('while (true) {if(__ordenSpin())break;}')
    expect(holder.content.querySelector('#dial')?.textContent).toBe('x')
  })

  test('with no script in it is left exactly as written', () => {
    const html = '<b>bold</b> <script type="text/template">while (true) {}</script>'
    expect(guardedBlock(html)).toBe(html)
  })

  test('guards a module the same way, and leaves a data block alone', () => {
    const out = guardedBlock(
      '<script type="module">for (;;) {}</script><script type="text/template">for (;;) {}</script>',
    )
    expect(out).toContain('<script type="module">for (;;) {if(__ordenSpin())break;}</script>')
    expect(out).toContain('<script type="text/template">for (;;) {}</script>')
  })
})

describe('what a block holds that cannot be guarded', () => {
  const scriptsOf = (html: string) => {
    const holder = document.createElement('template')
    holder.innerHTML = guardedBlock(html)
    return holder.content
  }

  test('a script from elsewhere is not run but says why', () => {
    const out = scriptsOf('<script src="https://example.com/a.js"></script><script>1</script>')
    const scripts = [...out.querySelectorAll('script')]
    expect(scripts.some((one) => one.hasAttribute('src'))).toBe(false)
    expect(scripts[1]?.textContent).toContain('console.error(')
    expect(scripts[1]?.textContent).toContain('from elsewhere')
    expect(scripts[2]?.textContent).toBe('1')
  })

  test('nor is one that does not parse, even if a browser would read it', () => {
    const scripts = [...scriptsOf('<script>while (true) { </script>').querySelectorAll('script')]
    expect(scripts[1]?.textContent).toContain('could not read')
    expect(scripts[1]?.textContent).not.toContain('while')
  })

  test('a handler written into an element or a javascript: address is taken out', () => {
    const out = scriptsOf(
      '<button onclick="while (true) {}" title="t">b</button><a href=" JaVa\tscript:for(;;){}">a</a><svg><a xlink:href="javascript:1"></a></svg><img src="x.png" onerror="for(;;){}">',
    )
    expect(out.querySelector('button')?.getAttribute('onclick')).toBeNull()
    expect(out.querySelector('button')?.getAttribute('title')).toBe('t')
    expect(out.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(out.querySelector('svg a')?.attributes).toHaveLength(0)
    expect(out.querySelector('img')?.getAttribute('src')).toBe('x.png')
    expect(out.querySelector('img')?.hasAttribute('onerror')).toBe(false)
  })

  test('a script with a pattern that could backtrack without end is not run but says why', () => {
    for (const code of [
      '/^(\\w+\\s?)+$/.test(text)',
      'const p = /(a+)+b/i',
      "new RegExp('(a|aa)+$')",
      'RegExp("(\\\\s*\\\\w+)*$", "g")',
      'new RegExp(`(x+x+)+y`)',
    ]) {
      expect(backtracks(code), code).toBe(true)
      const scripts = [...scriptsOf(`<script>${code}</script>`).querySelectorAll('script')]
      expect(scripts[1]?.textContent, code).toContain('forever to match')
    }
  })

  test('a script whose patterns end, or are made as it runs, is run', () => {
    for (const code of [
      '/^[a-z]+(-[a-z]+)*$/.test(text)',
      "text.replace(/\\d{4}-\\d{2}/g, '')",
      "const p = '(a+)+b'",
      'new RegExp(asked)',
      'new RegExp(`(${asked})+`)',
      "new Thing('(a+)+b')",
      'const x = 4 / 2 / 1',
    ]) {
      expect(backtracks(code), code).toBe(false)
    }
  })

  test('an address that only mentions javascript is kept', () => {
    const html = '<a href="https://example.com/javascript:guide">a</a>'
    expect(guardedBlock(html)).toBe(html)
  })
})

describe('the check the frame runs first', () => {
  test('lets a loop go on until its task has run past the limit, and cannot be replaced', () => {
    const holder = document.createElement('template')
    holder.innerHTML = guardedBlock('<script>for (;;) {}</script>')
    const [check, script] = [...holder.content.querySelectorAll('script')].map(
      (one) => one.textContent,
    )
    compiled(check ?? '')()

    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += 1))
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      compiled(script ?? '')()
      expect(now).toBeGreaterThanOrEqual(LOOP_LIMIT)
      expect(said).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
      said.mockRestore()
    }

    const global = globalThis as Record<string, unknown>
    expect(() => {
      global.__ordenSpin = () => false
    }).toThrow()
  })

  test('stops a loop around one that runs its own rounds, not only the inner one', async () => {
    await new Promise((settle) => setTimeout(settle, 10))
    const holder = document.createElement('template')
    holder.innerHTML = guardedBlock(
      '<script>let n = 0; for (;;) { if (++n > 100000) { globalThis.__ranOn = n; break } for (let i = 0; i < 1000; i++) {} }</script>',
    )
    const script = [...holder.content.querySelectorAll('script')][1]?.textContent ?? ''

    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += 1))
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      compiled(script)()
      expect((globalThis as Record<string, unknown>).__ranOn).toBeUndefined()
      expect(now).toBeLessThan(LOOP_LIMIT * 2)
    } finally {
      clock.mockRestore()
      said.mockRestore()
    }
  })
})

describe('a pattern a block makes as it runs', () => {
  function frame(): (code: string) => unknown {
    const holder = document.createElement('template')
    holder.innerHTML = guardedBlock('<script>1</script>')
    const check = holder.content.querySelector('script')?.textContent ?? ''
    const context = createContext({ performance, MessageChannel, console })
    runInContext('var self = globalThis', context)
    runInContext(check, context)
    return (code) => runInContext(code, context) as unknown
  }

  test('is refused where it could backtrack without end, however it is made', () => {
    const run = frame()
    for (const code of [
      'new RegExp("(a+)+$")',
      'RegExp("(a|a)*$", "i")',
      'var p = "(\\\\w+\\\\s?)+$"; new RegExp(p)',
      'new RegExp(/(a*)*$/.source)',
      '"aaaa!".match("(a+)+$")',
      '"aaaa!".search("(a|aa)+$")',
      '[..."aaaa!".matchAll("(a*)*$")]',
      '/x/.compile("(a+)+$")',
      'eval("/(a+)+$/.test(1)")',
      'Function("return /(a|a)+$/")',
      'new (async () => {}).constructor("return /(a+)+b/")',
    ]) {
      expect(() => run(code), code).toThrow(/forever to match/)
    }
  })

  test('is made as before where it cannot', () => {
    const run = frame()
    expect(run('new RegExp("a+b", "g").flags')).toBe('g')
    expect(run('RegExp("x") instanceof RegExp')).toBe(true)
    expect(run('Object.getPrototypeOf(new RegExp("x")) === RegExp.prototype')).toBe(true)
    expect(run('/(a)/.exec("a")[1]')).toBe('a')
    expect(run('"a,b".split(/,/).length')).toBe(2)
    expect(run('[..."abab".matchAll(/a/g)].length')).toBe(2)
    expect(run('"abc".match("b").index')).toBe(1)
    expect(run('eval("6 / 2 / 3")')).toBe(1)
    expect(run('Function("a", "return a / 2 / 1")(8)')).toBe(4)
    expect(run('eval("/[/]a+b/.test(\'/ab\')")')).toBe(true)
  })
})
