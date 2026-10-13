/** Whether a single newline breaks the line, for every caller that has no answer
 *  of its own.
 *
 *  Here rather than threaded through two dozen call sites, because the point of
 *  the setting is that a note cannot look different on two surfaces: the reading
 *  view, an export, a card on a canvas, the clipboard's HTML flavour and a hover
 *  preview all go through the renderer that reads this, and all of them should say the same thing
 *  without each remembering to ask. The app sets it once; see modes.svelte.ts.
 *
 *  A deck passes `breaks: true` and is unaffected either way, and the Worker that
 *  publishes a note passes the author's answer per request rather than setting it
 *  here - one isolate serves many readers, and a global would leak between
 *  them.
 *
 *  A module of its own rather than the renderer's, because the app sets it as it
 *  starts and the renderer - marked and everything a note can hold - is nothing a
 *  window needs before its first frame; see apps/desktop/test/weight.test.ts. */
let hard = false

export function setHardBreaks(on: boolean) {
  hard = on
}

export function hardBreaks(): boolean {
  return hard
}
