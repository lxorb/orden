/** What a file's name says it holds.
 *
 *  One table, because the answer is asked for in three places that must agree: a
 *  file handed over as itself through a dialog or a download, a file written into
 *  the browser's storage by an import, and a file the asset worker serves back to
 *  an `<img>`. A table per caller is how `image/svg` gets written down once and
 *  drawn nowhere.
 *
 *  Correctness matters in one direction and not the other. A browser will draw a
 *  JPEG announced as `image/jpg`, and will draw nothing at all for an SVG that is
 *  not `image/svg+xml`; a download named wrongly opens in the wrong program. So
 *  the spellings here are the ones the standards give rather than the extension
 *  with a family in front of it.
 *
 *  Two copies of this live elsewhere, each for a reason. public/sw.js is a classic
 *  script fetched before the app exists and cannot import anything;
 *  web/asset-route.test.ts reads that file and holds it to this table.
 *  export/pictures.ts keeps its own, smaller one: it is about pictures alone, it
 *  falls back to `image/png` rather than to bytes because a document being written
 *  needs something to put in a `data:` URI, and it carries the reverse map for
 *  naming a picture that arrived with no name at all. */

/** Bytes, and no claim about them: what a browser does with an unknown file
 *  anyway. */
export const UNKNOWN_TYPE = 'application/octet-stream'

/** Exported so the worker's own copy can be held to it; see asset-route.test.ts.
 *  Nothing reads it directly - `mimeOfPath` is the question worth asking. */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  // The spelling that says a WebM holds sound rather than a film, which is what a
  // recording made on Chromium is; see recorder/container.ts. `audio/webm` rather
  // than `audio/opus`, which is not a type any browser plays: the codec is inside
  // the container and the container is what a player is told about.
  weba: 'audio/webm',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

/** What the name says, or null for a name that says nothing. Null rather than a
 *  fallback, because what to do about not knowing differs: a download says bytes,
 *  a stored row says whatever was written beside it, a document being exported
 *  says a picture. */
export function mimeOfPath(path: string): string | null {
  // Anything a URL puts after the name is not part of it: `pic.png?v=2` is a PNG.
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(path)?.[1]?.toLowerCase() ?? ''
  return MIME_TYPES[extension] ?? null
}
