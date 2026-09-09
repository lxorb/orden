import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import manifest from '../../../even.app.json'

/** What the store's review reads, held to what it asks for.
 *
 *  It refused a build twice, and both findings are about the *bundle* rather than
 *  about anything the plugin does:
 *
 *    1. "Bundle contains URLs not covered by `network.whitelist`. (37 unlisted
 *       URL(s): ['https://svelte.dev/e/props_invalid_value', ...])"
 *    2. "`new Function()` is used in the bundle. Heads up: `new Function()`
 *       evaluates dynamic code (same risk class as `eval()`)."
 *
 *  Neither is something a unit test of the app could have caught, because neither
 *  is about the app: they are about which libraries came along. So this builds the
 *  plugin the way a release does and reads the folder that is packed, which is the
 *  only place either question has an answer.
 *
 *  It is slow, and that is the price of the only test that could have prevented a
 *  release from failing at the last step. */

const app = resolve(import.meta.dirname, '../../..')
const staged = join(app, 'dist-even')

/** The origins the manifest allows. Anything else must not be in the package at
 *  all, whether or not it is ever asked for. */
const allowed = manifest.permissions.find((one) => one.name === 'network')?.whitelist ?? []

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }

  return out
}

let files: { name: string; text: string }[] = []

beforeAll(() => {
  // The plugin's own build, not the editor's: what it ships is decided by leaving
  // code out, and only this build leaves it out. See vite.even.config.ts.
  execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'vite.even.config.ts'], {
    cwd: app,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
  execFileSync('node', [resolve(app, '../../scripts/even-stage.mjs'), staged, staged], {
    cwd: app,
    stdio: 'pipe',
  })

  files = walk(staged)
    .filter((one) => /\.(js|css|html|json|webmanifest)$/.test(one))
    .map((one) => ({ name: one.slice(staged.length + 1), text: readFileSync(one, 'utf8') }))
}, 300_000)

describe('the bundle a package is made of', () => {
  test('is there at all, and is the plugin under both names', () => {
    expect(files.length).toBeGreaterThan(10)
    const both = files.filter((one) => one.name === 'even.html' || one.name === 'index.html')
    expect(both).toHaveLength(2)
    expect(both[0]?.text).toBe(both[1]?.text)
  })

  /** The review's first finding. */
  test('carries no URL the manifest does not allow', () => {
    const off: string[] = []

    for (const file of files) {
      for (const found of file.text.matchAll(/https?:\/\/[^\s"'`)\\<>]*/g)) {
        const url = found[0]
        if (allowed.some((one) => url.startsWith(one))) continue
        off.push(`${url}   [${file.name}]`)
      }
    }

    expect(off.slice(0, 12).join('\n')).toBe('')
  })

  test('holds the whitelist to the manifest, so the two cannot drift', () => {
    expect(allowed.length).toBeGreaterThan(0)
    for (const one of allowed) expect(one).toMatch(/^https:\/\//)
  })

  /** The review's second finding, and Emil's answer to it: "JavaScript execution
   *  is not needed by the Even Realities plugin, so for the plugin it can be
   *  disabled." So this is not about how a construct is written; it is about the
   *  plugin having no way to evaluate a string at all. */
  test('turns no string into code, by any of the ways there are', () => {
    const ways = [
      /new\s+Function\s*\(/,
      /[^.\w$]Function\s*\(/,
      // Not only `eval(`: the sandbox this replaces called it as `(0, eval)(CODE)`
      // to get the global one, and a name that is only ever mentioned to be called
      // is worth failing on however it is written. Not a bare `eval` though -
      // Clojure's highlighting mode lists it among that language's own words, and a
      // word in a list of words is not a call.
      /[^.\w$]eval\s*[()]/,
      // A timer given a string is `eval` with a delay in front of it.
      /set(?:Timeout|Interval)\s*\(\s*['"`]/,
    ]

    const found: string[] = []
    for (const file of files) {
      for (const way of ways) {
        const at = way.exec(file.text)
        if (at)
          found.push(
            `${file.name}: ...${file.text.slice(Math.max(0, at.index - 60), at.index + 40)}`,
          )
      }
    }

    expect(found.slice(0, 6).join('\n\n')).toBe('')
  })

  /** The play button and everything under it: the panel that draws it, the
   *  protocol it speaks and the sandbox that would run the code.
   *
   *  Asked of the code rather than of the whole folder, because the stylesheet
   *  still carries the panel's own rules: they come from the theme's stylesheet
   *  rather than from the module, and a rule for an element nothing makes styles
   *  nothing. The button is what a reader can press, and the button is not here. */
  test('has no way to run a fence, and no button offering to', () => {
    const runner = files.filter(
      (one) =>
        one.name.endsWith('.js') &&
        (one.text.includes('nib-run-panel') || one.text.includes('nib-run-output')),
    )

    expect(runner.map((one) => one.name)).toEqual([])
  })

  test('and none of the sandbox that would have run it', () => {
    // The runner marks every message between the page and its sandboxed frame with
    // this, and nothing else in the app uses it. That frame is where the
    // `new Function` and the `eval` the review found lived.
    for (const file of files) {
      if (!file.name.endsWith('.js')) continue
      expect(file.text, file.name).not.toContain('nib-run')
    }
  })

  test('leaves out the libraries a pair of glasses cannot use', () => {
    // Each of these was a finding of its own: mermaid and its parser stack, the
    // document exporters, the PDF viewer. Named by a string only they carry.
    const gone: Record<string, string> = {
      mermaid: 'mermaid-js/mermaid',
      chevrotain: 'chevrotain',
      cytoscape: 'cytoscape',
      docx: 'wordprocessingml',
      jszip: 'JSZip',
      'flowchart.js': 'raphaeljs',
      // A fifth of the package on its own, and the one that was hardest to see:
      // `openEntry` declines to open a PDF here, but the viewer is a component of a
      // pane, so the library came along anyway.
      'pdfjs-dist': 'pdfjs_internal',
    }

    const here = Object.entries(gone)
      .filter(([, mark]) => files.some((one) => one.text.includes(mark)))
      .map(([name]) => name)

    expect(here).toEqual([])
  })

  test('is small enough for the platform to be comfortable with', () => {
    const bytes = walk(staged).reduce((sum, one) => sum + statSync(one).size, 0)
    // 6.0 MB as this is written, and 2.7 MB packed. The ceiling is close to it on
    // purpose: this number went from 11.8 MB to 6.0 by leaving libraries out, and a
    // megabyte back is a library that crept in again. Speed is the selling point,
    // and on a phone the download is part of it.
    expect(bytes).toBeLessThan(8 * 1024 * 1024)
  })
})
