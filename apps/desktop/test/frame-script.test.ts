import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type DOMWindow, JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { htmlFrameDocument } from '@orden/editor'

const SCRIPT = readFileSync(
  join(import.meta.dirname, '../../../packages/editor/src/frame-script.js'),
  'utf8',
)

function framed(html: string, url = 'about:blank'): DOMWindow & Record<string, unknown> {
  const dom = new JSDOM(htmlFrameDocument(html, SCRIPT), {
    url,
    runScripts: 'outside-only',
  })
  const window = dom.window as DOMWindow & Record<string, unknown>
  window.reportError = (error: unknown) => {
    ;((window.reported ??= []) as unknown[]).push(error)
  }
  window.eval(SCRIPT)

  return window
}

const said = (word: string, type = '') =>
  `<script${type ? ` type="${type}"` : ''}>(window.said ??= []).push('${word}')</script>`

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the frame script', () => {
  test('puts the block into the page and runs its scripts in the order written', async () => {
    const window = framed(`<div id="dial">nothing</div>${said('one')}${said('two')}`)
    await settled()

    expect(window.document.getElementById('dial')?.textContent).toBe('nothing')
    expect(window.said).toEqual(['one', 'two'])
  })

  test('runs a module after the classic scripts, the way a module is deferred', async () => {
    const window = framed(`${said('module', 'module')}${said('classic')}`)
    await settled()

    expect(window.said).toEqual(['classic', 'module'])
  })

  test('leaves a data block as the data it is', async () => {
    const window = framed(`${said('template', 'text/template')}${said('json', 'application/json')}`)
    await settled()

    expect(window.said).toBeUndefined()
    expect(window.document.querySelectorAll('script[type="text/template"]')).toHaveLength(1)
  })

  test('tells a classic script which it is, and a module nothing', async () => {
    const window = framed(
      '<script id="me">window.classic = document.currentScript?.id</script>' +
        '<script type="module">window.module = document.currentScript</script>',
    )
    await settled()

    expect(window.classic).toBe('me')
    expect(window.module).toBeNull()
    expect(Object.getOwnPropertyDescriptor(window.document, 'currentScript')).toBeUndefined()
  })

  test('reports a script that throws, and runs the next one regardless', async () => {
    const window = framed(`<script>throw new Error('broken')</script>${said('after')}`)
    await settled()

    expect((window.reported as Error[] | undefined)?.map((one) => one.message)).toEqual(['broken'])
    expect(window.said).toEqual(['after'])
  })

  test('shares what a script declares with `var` with the next, as a page does', async () => {
    const window = framed('<script>var shared = 6</script><script>window.got = shared * 7</script>')
    await settled()

    expect(window.got).toBe(42)
  })

  test('and then says how tall the block turned out', async () => {
    const window = framed('<p>words</p>')
    const heard: unknown[] = []
    window.addEventListener('message', (event) => heard.push(event.data))
    await settled()
    await settled()

    expect(heard).toContainEqual(expect.objectContaining({ nib: 'nib-html-frame' }))
  })

  test('runs nothing anywhere but an opaque origin', async () => {
    const window = framed(`<div id="dial"></div>${said('one')}`, 'https://orden.so/')
    await settled()

    expect(window.document.getElementById('dial')).toBeNull()
    expect(window.said).toBeUndefined()
  })

  test('refuses a loop in code a block makes from text, and runs the rest of it', async () => {
    const window = framed(`<script>
      const refused = []
      const tried = (run) => {
        try {
          run()
        } catch (error) {
          refused.push(error.name)
        }
      }
      tried(() => eval('while (true) {}'))
      tried(() => new Function('for (;;) {}'))
      tried(() => Function('do {} while (true)'))
      tried(() => (async function () {}).constructor('while (true) {}'))
      tried(() => (function* () {}).constructor('for (;;) yield 1'))
      tried(() => setTimeout('while (true) {}'))
      tried(() => setInterval('for (;;) {}', 10))
      window.refused = refused
      window.sum = eval('1 + 1') + new Function('a', 'return a * 2')(20)
      let rounds = 0
      for (let i = 0; i < 3; i++) rounds++
      window.rounds = rounds
    </script>`)
    await settled()

    expect(window.refused).toEqual(Array(7).fill('EvalError'))
    expect(window.sum).toBe(42)
    expect(window.rounds).toBe(3)
  })

  test('leaves a block no WebAssembly and no request it would wait on', async () => {
    const window = framed(`<script>
      window.assembly = typeof WebAssembly
      const request = new XMLHttpRequest()
      try {
        request.open('GET', 'https://example.com/', false)
      } catch (error) {
        window.waited = error.name
      }
      new XMLHttpRequest().open('GET', 'https://example.com/')
      window.asked = true
    </script>`)
    await settled()

    expect(window.assembly).toBe('undefined')
    expect(window.waited).toBe('InvalidAccessError')
    expect(window.asked).toBe(true)
  })

  test('leaves code made from text alone in a frame that runs no block', () => {
    const dom = new JSDOM(
      '<!doctype html><body><script type="text/plain" id="nib-frame">window.made = eval("for (;;) { break }; 5")</script>',
      { url: 'about:blank', runScripts: 'outside-only' },
    )
    const window = dom.window as DOMWindow & Record<string, unknown>
    window.eval(SCRIPT)

    expect(window.made).toBe(5)
  })
})
