export { lentMoved, loading, openDocument, pageSizes, pdfjs, warmPdf } from './document'
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
} from './highlights'
export { type PdfHeading, readOutline } from './outline'
export { PDF_TO_CSS, sheetFor } from './pages'
export {
  closeUpOf,
  densityFor,
  drawScale,
  holdPaper,
  outlineOf,
  type Paper,
  paperAhead,
  paperEdition,
  paperIsLocked,
  paperOf,
  paperPathOf,
  paperPlaces,
  paperRewritten,
  PapersHeld,
  type PaperView,
  type Part,
  sharpness,
  textsOf,
  viewOf,
  type Words,
  wordsInto,
} from './paper'
export { cssColour, paperPicture, paperUnder, svgToPng } from './raster'
export { marksFromOutside, marksWritten, sheetArrived } from './sheets.svelte'
export { editHighlights, loadHighlights } from './sidecar'

export const papers = () => import('./papers')

export const handed = () => import('./handed')

export const readPapers: typeof import('./extract').readPapers = (...args) =>
  import('./extract').then((one) => one.readPapers(...args))

export const paperText: typeof import('./text-cache').paperText = (...args) =>
  import('./text-cache').then((one) => one.paperText(...args))
