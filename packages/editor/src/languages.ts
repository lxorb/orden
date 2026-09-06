import type { LanguageDescription } from '@codemirror/language'
import { ADDED, plainTextDescription } from './language-modes'
import { spelled } from './language-spellings'
import { mermaidDescription } from './mermaid'

/** Every language a fence may name, in one list.
 *
 *  `@codemirror/language-data` brings 143 of them and each one imports itself
 *  the first time a fence asks for it - nothing here is in the startup bundle.
 *  What that list is short on is *spellings*: it knows the language by its
 *  name, and a fence is opened by whatever word came to hand.
 *
 *  So the bulk of this is a vocabulary, and only then a language list. Adding a
 *  spelling to a language that is already here is one line in `SPELLINGS`, in
 *  language-spellings.ts; adding a language nobody has ported is one entry in
 *  `ADDED`, in language-modes.ts. This file is only the order they go in. */

/** What a fence's info word is matched against - by the editor while the note
 *  is open, and by the HTML export afterwards, so a document leaves looking
 *  the way it did on screen. */
export const fenceLanguages: LanguageDescription[] = [
  plainTextDescription,
  ...spelled,
  ...ADDED,
  // Mermaid's parser lives beside the code that draws the diagram.
  mermaidDescription,
]

// Re-exported because the vocabulary and the list it is applied to are checked
// against each other by a test, which reads both through this one door.
export { SPELLINGS } from './language-spellings'
