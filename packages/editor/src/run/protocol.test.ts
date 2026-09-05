import { describe, expect, test } from 'vitest'
import { parseRunMessage, runnerDocument } from './protocol'

const message = (extra: Record<string, unknown> = {}) => ({
  nib: 'nib-run',
  run: 7,
  lines: [{ level: 'log', text: 'hi' }],
  done: false,
  ...extra,
})

describe('reading a message from the sandbox', () => {
  test('takes the lines and whether the run is over', () => {
    expect(parseRunMessage(message({ done: true }), 7)).toEqual({
      run: 7,
      lines: [{ level: 'log', text: 'hi' }],
      ready: false,
      done: true,
    })
  })

  test('reads the word that says the code is about to start', () => {
    const first = parseRunMessage(message({ lines: [], ready: true }), 7)
    expect(first).toMatchObject({ ready: true, done: false, lines: [] })
  })

  test('ignores a message from a run that has been replaced', () => {
    expect(parseRunMessage(message(), 8)).toBeNull()
  })

  test('ignores anything else on the page that posts messages', () => {
    expect(parseRunMessage({ type: 'webpackHot' }, 7)).toBeNull()
    expect(parseRunMessage(message({ nib: 'something-else' }), 7)).toBeNull()
    expect(parseRunMessage('hello', 7)).toBeNull()
    expect(parseRunMessage(null, 7)).toBeNull()
  })

  test('ignores a message whose lines are not lines', () => {
    expect(parseRunMessage(message({ lines: 'hi' }), 7)).toBeNull()
    expect(parseRunMessage(message({ lines: [{ level: 'log' }] }), 7)).toBeNull()
    expect(parseRunMessage(message({ lines: [{ level: 'shout', text: 'hi' }] }), 7)).toBeNull()
    expect(parseRunMessage(message({ lines: [null] }), 7)).toBeNull()
  })

  test('reads a batch with no lines in it, which is how a run ends quietly', () => {
    expect(parseRunMessage(message({ lines: [], done: true }), 7)?.done).toBe(true)
  })
})

describe('the document the sandbox runs', () => {
  test('leaves the code nothing to reach', () => {
    const html = runnerDocument('1 + 1', 1)
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("script-src 'unsafe-inline' 'unsafe-eval'")
  })

  test('carries the run number, so its output can be told apart', () => {
    expect(runnerDocument('1', 42)).toContain('var RUN = 42')
  })

  test('is JavaScript that compiles, embedded formatter and all', () => {
    // The script is written as text, so nothing type checks it. Compiling it
    // here catches a stray backtick or a broken embedding before it ships.
    const script = /<script>([\s\S]*)<\/script>/.exec(runnerDocument("console.log('hi')", 1))
    expect(script).not.toBeNull()
    expect(() => new Function(script![1])).not.toThrow()
  })

  test('cannot be escaped from by code that closes the script element', () => {
    const html = runnerDocument('const tag = "</script><script>alert(1)</script>"', 1)
    // One script element: the one this file wrote.
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).not.toContain('alert(1)</script>')
  })

  test('cannot be escaped from by code that opens an HTML comment', () => {
    expect(runnerDocument('// <!--', 1)).not.toContain('<!--')
  })

  test('hands the code through as itself, quotes and newlines and all', () => {
    const code = "console.log('a\\nb')\n`back` + \"tick\""
    const html = runnerDocument(code, 1)
    const literal = /var CODE = (".*")\n/.exec(html)
    expect(literal).not.toBeNull()
    expect(JSON.parse(literal![1].replace(/\\u003c/g, '<'))).toBe(code)
  })
})
