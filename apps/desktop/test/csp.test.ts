import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { CSP, META_CSP } from '../src/csp'

/** One policy, in three files that cannot import from each other: `src/csp.ts` is
 *  the one the dev server reads, `src-tauri/tauri.conf.json` is what the installed
 *  app is served with, and `index.html` is what a browser and the PWA get. A copy
 *  that drifts is an app that is one thing while it is being written and another
 *  once it is installed, which is the failure this file exists to catch.
 *
 *  Each carrier is held to the form it can actually carry. The two that deliver a
 *  `<meta http-equiv>` must not name `frame-ancestors`: a browser cannot honour it
 *  there - who may frame a page is settled before the page is parsed - and it says
 *  so on the console on every page load, which is an error in a shipping build and
 *  the one every drive in `test/e2e` tripped over. The header form keeps it, since
 *  a header is sent before the document. See src/csp.ts. */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const TAURI = JSON.parse(read('../src-tauri/tauri.conf.json')) as {
  app: { security: { csp: string | null } }
}

const INDEX = read('../index.html')

/** The dev and preview servers, which are the carriers that send a header. Read as
 *  text: the config runs git and builds a stamp, and which constant it hands the
 *  servers is the whole of what matters here. */
const VITE = read('../vite.config.ts')

/** The policy `index.html` declares, as the browser reads it: the attribute's
 *  value, with the newlines and indentation prettier put in taken back out. */
function metaPolicy(html: string): string {
  const found = /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]*)"/.exec(html)
  return (found?.[1] ?? '').replace(/\s+/g, ' ').trim()
}

describe('the content policy', () => {
  test('is the same string in all three places, each in the form it can carry', () => {
    expect(TAURI.app.security.csp).toBe(META_CSP)
    expect(metaPolicy(INDEX)).toBe(META_CSP)
    // And the header form is the meta form plus what only a header may say, so the
    // two can never be two policies.
    expect(CSP.startsWith(`${META_CSP}; `)).toBe(true)
  })

  /** The console error this split exists to remove. A `<meta>` that names
   *  `frame-ancestors` is a line the browser rejects out loud on every page load,
   *  and every drive in `test/e2e` fails on any console error. */
  test('never names frame-ancestors where a browser cannot honour it', () => {
    expect(META_CSP).not.toContain('frame-ancestors')
    expect(TAURI.app.security.csp).not.toContain('frame-ancestors')
    expect(metaPolicy(INDEX)).not.toContain('frame-ancestors')
  })

  test('and says it where a browser can, which is a header', () => {
    expect(CSP).toContain("frame-ancestors 'none'")
    expect(VITE).toContain("'Content-Security-Policy': CSP")
    expect(VITE).not.toContain('META_CSP')
  })

  test('is before anything the page loads, so it governs all of it', () => {
    expect(INDEX.indexOf('Content-Security-Policy')).toBeLessThan(INDEX.indexOf('<script'))
    expect(INDEX.indexOf('Content-Security-Policy')).toBeLessThan(INDEX.indexOf('<link'))
  })

  /** The lines that are the whole point. A policy is easy to widen by accident -
   *  one keyword in the wrong directive and the thing it was written for is gone. */
  test('lets no element on any page carry an event handler', () => {
    // The `onerror` in `<img src=x onerror=…>`, which is what a note somebody was
    // handed would use: `<script>` inserted through innerHTML never runs, and a
    // handler on an attribute does.
    expect(CSP).toContain("script-src-attr 'none'")
  })

  test('and loads no code from anywhere but this app', () => {
    for (const directive of ['script-src', 'script-src-elem', 'worker-src']) {
      const line = CSP.split('; ').find((one) => one.startsWith(`${directive} `)) ?? ''
      expect(line, directive).toContain("'self'")
      expect(line, directive).not.toContain('http:')
      expect(line, directive).not.toContain('https:')
      expect(line, directive).not.toContain('data:')
    }
  })

  test('and keeps the styles a running editor writes', () => {
    // A nonce anywhere in `style-src` would make the browser ignore
    // `'unsafe-inline'`, and every cursor CodeMirror places is a style attribute.
    expect(CSP).toContain("style-src 'self' 'unsafe-inline'")
    expect(CSP).not.toContain('nonce-')
  })

  test('and says the four things that fall back to nothing useful', () => {
    for (const said of [
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(CSP).toContain(said)
    }

    // Three of the four in a `<meta>` as well; the fourth is the one a parsed
    // document is too late to say. See src/csp.ts.
    for (const said of ["object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
      expect(META_CSP).toContain(said)
    }
  })

  test('and lets Tauri talk to its own back end', () => {
    // Without these the app cannot read a single file: the commands travel over a
    // protocol of Tauri's, which is a scheme on some platforms and a host on others.
    const connect = CSP.split('; ').find((one) => one.startsWith('connect-src ')) ?? ''
    expect(connect).toContain('ipc:')
    expect(connect).toContain('http://ipc.localhost')
  })
})
