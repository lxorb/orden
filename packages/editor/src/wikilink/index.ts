import type { Extension } from '@codemirror/state'
import { modifierWatch } from '../links'
import { noteClicks } from './follow'
import { notePreviews } from './hover'

export const wikilinks = (): Extension => [modifierWatch, noteClicks, notePreviews]
