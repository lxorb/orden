export {
  lentMoved,
  loading,
  openBytes,
  openDocument,
  type OpenPdf,
  pageSizes,
  pdfjs,
  warmPdf,
} from './document'
export { placesOnPaper, runsOfItems, spansOver, textOfRuns, wordsOfRuns } from './find'
export {
  boxOf,
  citation,
  COLOURS,
  frozen,
  type Held,
  type Highlight,
  matrixOf,
  type Quad,
  toViewport,
  type Transform,
} from './highlights'
export { type PdfHeading, readOutline } from './outline'
export { PDF_TO_CSS, sheetFor } from './pages'
export type { AwayDraw } from './paper-away'
export { marksFromOutside, marksWritten, sheetArrived } from './sheets.svelte'
export { editHighlights, loadHighlights } from './sidecar'

export const paperAway = () =>
  __EVEN_PLUGIN__ || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined'
    ? null
    : import('./paper-away')

export const papers = () => import('./papers')

export const handed = () => import('./handed')

export const readPapers: typeof import('./extract').readPapers = (...args) =>
  import('./extract').then((one) => one.readPapers(...args))

export const paperText: typeof import('./text-cache').paperText = (...args) =>
  import('./text-cache').then((one) => one.paperText(...args))
