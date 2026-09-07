/** A piece of text with one style, and the ligature glyphs among them.
 *
 *  A run is the smallest thing the panel draws: some characters, one face, one
 *  size, one brightness. Wrapping breaks runs, pages hold lines of them, and
 *  the rasteriser draws them one after another. */

import { findLigatures, type LigatureScope } from '@nib/editor'
import type { TextStyle } from './style'

/** A formula in place of words. How big it comes out is the measurer's answer,
 *  asked when the line is wrapped and again when it is drawn; see measure.ts,
 *  which is why the answer is cached there rather than carried here. */
export interface MathRun {
  tex: string
  /** A `$$` block rather than a `$…$` span: bigger, and on its own line. */
  display: boolean
}

/** A picture in place of words. */
interface PictureRun {
  source: string
}

export interface Run {
  /** What is drawn. For a formula or a picture, what is drawn instead if the
   *  drawing cannot be had: the TeX, or the words it was described as. */
  text: string
  style: TextStyle
  /** When the run is a ligature glyph, the characters it stands for.
   *
   *  The glyph is drawn over the width those characters would have taken,
   *  exactly as the editor paints it over them: a fence's columns still line
   *  up, and a note reads the same width whether the glyphs are on or off. */
  over?: string
  /** A box drawn behind the run, at this grey: an inline code span, a mark. */
  box?: number
  /** Pixels above the baseline: a superscript up, a subscript down. */
  rise?: number
  math?: MathRun
  picture?: PictureRun
  /** A hard break. The run has no words. */
  break?: true
}

/** Whether the characters at hand may become glyphs. `code` draws them in a
 *  fence and in an inline span and nowhere else, which is why the caller has to
 *  say which it is holding; see `ligatures.ts` in the editor package. */
export function drawsGlyphs(scope: LigatureScope, isCode: boolean): boolean {
  return scope === 'all' || (scope === 'code' && isCode)
}

/** One run split wherever a run of characters stands for a glyph. The glyph
 *  keeps the style around it, so an arrow inside a keyword is still a keyword.
 *
 *  The same table the editor draws from - `findLigatures` is its own finder -
 *  so `->` is the same arrow in both places or in neither. */
export function withGlyphs(text: string, style: TextStyle): Run[] {
  const found = findLigatures(text)
  if (!found.length) return text ? [{ text, style }] : []

  const out: Run[] = []
  let last = 0

  for (const one of found) {
    if (one.from > last) out.push({ text: text.slice(last, one.from), style })
    out.push({ text: one.glyph, style, over: text.slice(one.from, one.to) })
    last = one.to
  }

  if (last < text.length) out.push({ text: text.slice(last), style })
  return out
}

/** A run of plain text, with the glyphs in it if the scope allows them. The one
 *  door everything that adds words to a line goes through. */
export function textRuns(
  text: string,
  style: TextStyle,
  options: { scope: LigatureScope; code: boolean },
): Run[] {
  if (!text) return []
  if (!drawsGlyphs(options.scope, options.code)) return [{ text, style }]

  return withGlyphs(text, style)
}
