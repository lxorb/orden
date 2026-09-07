/** The GFM plugin ships no types of its own. It exports one function per table
 *  of rules and a `gfm` that applies them all, which is the only one used. */
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'

  export const gfm: TurndownService.Plugin
}
