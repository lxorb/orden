import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/** Chrome and the app's theme are easy to drift apart quietly, because the
 *  browser has a default for everything and a default always looks like it
 *  works. These are the two that have bitten so far, so they are checked
 *  rather than remembered. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (name.endsWith('.svelte')) out.push(path)
  }

  return out
}

/** Only the `<style>` block: markup carries `selected=` attributes, and a scan
 *  of the whole file reads those as CSS. */
function styleOf(text: string): string {
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((one) => one[1]).join('\n')
}

const components = componentFiles(SOURCE).map((path) => ({
  name: path.slice(SOURCE.length).replace(/\\/g, '/'),
  text: styleOf(readFileSync(path, 'utf8')),
}))

describe('the look of things the browser also has an opinion about', () => {
  test('the scan finds the components', () => {
    expect(components.length).toBeGreaterThan(10)
  })

  test('nothing opts out of the themed scrollbar', () => {
    // `scrollbar-width` is the standard property, and setting it makes Chromium
    // ignore `::-webkit-scrollbar` for that element - so a component asking for
    // a thin scrollbar silently gets the operating system's instead of ours.
    // `none` is fine: that is a deliberate hide, not a different scrollbar.
    // Named outright rather than "not none": `\s*` can match nothing and let a
    // lookahead slip past the space, which flagged every deliberate hide.
    const offenders = components
      .filter((one) => /scrollbar-width:\s*(thin|auto)/.test(one.text))
      .map((one) => one.name)

    expect(offenders, `these would show the browser's scrollbar: ${offenders}`).toEqual([])
  })

  test('no component restyles a dropdown on its own', () => {
    // One rule in the theme package draws every dropdown, arrow included. A
    // second one in a component is how they drift apart.
    // Only restyling counts. Sizing one in a layout is a component's business;
    // giving it its own colours, border or arrow is not.
    const offenders = components
      .filter((one) =>
        [...one.text.matchAll(/(?<![\w-])select(?![\w-])[^{;]*\{([^}]*)\}/g)].some(([, body]) =>
          /(appearance|background|border|font-family)\s*:/.test(body),
        ),
      )
      .map((one) => one.name)

    expect(offenders, `these would diverge from the themed dropdown: ${offenders}`).toEqual([])
  })
})
