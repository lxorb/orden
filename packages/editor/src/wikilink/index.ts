import type { Extension } from '@codemirror/state'
import { modifierWatch } from '../links'
import { noteClicks } from './follow'
import { notePreviews } from './hover'

export function wikilinks(): Extension {
  return [modifierWatch, noteClicks, notePreviews]
}
