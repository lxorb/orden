/* The folder that goes into an .ehpk.

   The build writes two pages out of one bundle, `index.html` for the editor and
   `even.html` for the plugin. Packing that folder as it stands leaves the
   question of which page the phone app opens, and the answer is not published
   anywhere: the manifest names `even.html` as the entrypoint, but an app that
   ignores the manifest and opens `index.html` would get the plain editor, which
   signs in, syncs, and knows nothing about any glasses. That is exactly what a
   plugin doing nothing on a device looks like.

   So the question is removed rather than answered. This stages a copy in which
   *both* names are the plugin, and the editor's own page is not in it at all.
   Whichever one the phone app opens, it opens the plugin.

   The assets are shared and are copied as they are.

     node scripts/even-stage.mjs [from] [to]   (default apps/desktop/dist and
                                                apps/desktop/dist-even) */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const from = process.argv[2] ?? join('apps', 'desktop', 'dist')
const to = process.argv[3] ?? join('apps', 'desktop', 'dist-even')

const plugin = join(from, 'even.html')
let page
try {
  page = readFileSync(plugin, 'utf8')
} catch {
  console.error(`no ${plugin}: run the build first`)
  process.exit(1)
}

// A whole new folder every time, so nothing from an older build survives into a
// package by accident.
rmSync(to, { recursive: true, force: true })
mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true })

// Both names, one page. The editor's index.html is overwritten rather than
// deleted, so there is no name in the package that answers with anything else.
writeFileSync(join(to, 'index.html'), page)
writeFileSync(join(to, 'even.html'), page)

// The editor's own service worker and manifest have no business in a package
// that is opened from files on a phone.
for (const stray of ['manifest.webmanifest', 'sw.js', 'registerSW.js']) {
  rmSync(join(to, stray), { force: true })
}

console.log(`${to}: index.html and even.html are both the plugin`)
