/** What a note never contains, as a selector a DOM can be swept with.
 *
 *  The list itself is `NEVER` in `@nib/markdown/from-html`, where the converter
 *  refuses the same elements a second time in case one reaches it another way.
 *  Here it becomes one selector, plus the two things only a DOM can see: a field
 *  that is not a task list's tick, and whatever the page itself says is
 *  decoration rather than content. */

import { NEVER } from '@nib/markdown/from-html'

export const NOT_CONTENT = [...NEVER, 'input:not([type="checkbox"])', '[aria-hidden="true"]'].join(
  ',',
)
