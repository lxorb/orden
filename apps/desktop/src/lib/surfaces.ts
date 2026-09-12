/** The surfaces a pane can show that are not the editor, each fetched the first time
 *  a tab of its kind is opened.
 *
 *  A window opens on a note, and until batch 109 it opened on every other document
 *  kind as well: the canvas with its ink, its geometry and its hand tools, the PDF
 *  viewer, the pages engine, the graph with its layout and its painter, the webview
 *  tab. Together they are the larger half of the app's own code, and none of it is
 *  needed to put a note on screen - which is what "nib opens like Notepad" means.
 *
 *  One promise each, kept, so that a canvas is fetched once however many are opened
 *  and switching back to one is not a second wait. `{#await}` on a promise that has
 *  already resolved renders in the same pass, so only the first tab of a kind ever
 *  sees the empty frame. See Pane.svelte, which is the only caller.
 *
 *  Route-level and nothing finer: a surface is what a tab *is*, so the tab's kind is
 *  the honest boundary. Anything inside one of them that is heavy again - the diagram
 *  drawers, the exporters, the syntax parsers - is already behind a boundary of its
 *  own. */

/** One lazy component, held. The default export rather than the module, because that
 *  is what a template can name. */
function held<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
  let asked: Promise<T> | null = null
  return () => (asked ??= load().then((one) => one.default))
}

/** A plane of cards, its ink and its tools. The largest of them by a good way. */
export const canvasSurface = held(() => import('./Canvas.svelte'))

/** The space as a picture: the layout, the painter and the controls over it. */
export const graphSurface = held(() => import('./Graph.svelte'))

/** Pages of paper, for a note laid out rather than flowed. */
export const pagesSurface = held(() => import('./Pages.svelte'))

/** A paper being read, beside the notes about it. Brings pdf.js with it. */
export const pdfSurface = held(() => import('./Pdf.svelte'))

/** A website in a tab. See docs/web-tabs.md. */
export const webSurface = held(() => import('./web-tab/WebTab.svelte'))
