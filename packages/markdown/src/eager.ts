/** Both engines imported outright, for a caller that should not wait for either.
 *
 *  One import of this module and `renderMarkdown` behaves exactly as it did before
 *  either was loaded lazily: no awaits, no first render without a formula in it.
 *
 *  It exists for the Worker that publishes a note. An isolate answers one request
 *  and is gone, so a lazy import there is not a load spread over a session - it is a
 *  load per request, or a cold start that pays for it anyway. The app must not import
 *  this: the point of engines.ts is that the app's first paint does not carry
 *  three quarters of a megabyte it usually has no use for. */

import * as emoji from 'node-emoji'
import { useEmoji, useMaths } from './engines'
import katex from './maths'

useMaths(katex)
useEmoji(emoji)
