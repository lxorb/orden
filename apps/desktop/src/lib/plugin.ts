/** Whether this page is the Even Realities plugin rather than the app.
 *
 *  The plugin is the same build with one entry of its own, so nothing about the
 *  code says which page is running: `even.ts` says so, before anything is
 *  mounted, and everything that is only true of the plugin asks here.
 *
 *  A flag rather than a check of something on the page, because the page is the
 *  same page. A function rather than a constant, because the answer is set at
 *  the top of the entry and read later, and a constant would be read first.
 *
 *  Deliberately tiny and importing nothing: the app's own settings read it, so
 *  it is in the plain build, and it must not drag the glasses code in with it.
 *  Everything that does live in `lib/even`, which the plain build never
 *  reaches. */

let plugin = false

/** Said once, by the plugin's own entry. */
export function markPlugin(): void {
  plugin = true
}

export function isPlugin(): boolean {
  return plugin
}
