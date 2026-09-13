/** The sentences more than one module refuses with.
 *
 *  Every refusal here is a sentence the app shows somebody, word for word: the
 *  service answers `{ error }` and the app drops it into a line of its own text,
 *  which is why they are lowercase and why none of them names a field a reader has
 *  never heard of. That makes each one wire text. A sentence two modules both send
 *  has to be the same sentence, and ten of them were two copies of a string
 *  literal - which is a sentence that stays the same until somebody improves one of
 *  them.
 *
 *  Only the ones more than one module sends. A sentence one route sends three times
 *  is that route's own constant, beside the route; there is nothing to be gained by
 *  moving a module's own words away from it.
 *
 *  Nothing here is translated. The app translates what it shows, and these arrive as
 *  the fallback text for a client that has nothing better; see i18n.svelte.ts at
 *  the other end. */

/** A body that was not the object the route reads its fields out of. The nine
 *  routes that read their own fields; see objectBody in body.ts. */
export const NOT_AN_OBJECT = 'send an object'

/** A note id nobody in this account can reach. Not "you may not": whether a note
 *  exists is itself something a stranger should not learn. */
export const NO_SUCH_NOTE = 'no such note'

/** No session, or one that has finished. The guard on `/v1/*`, the room's socket
 *  and the MCP endpoint each answer it, because each is reached without one. */
export const SIGN_IN = 'sign in first'

/** An emailed code, or the one out of an authenticator, that was not the code. The
 *  same words for both, deliberately: which of the two was wrong is not something
 *  to tell somebody guessing. */
export const WRONG_CODE = 'that code is not right'

/** A sign-in or a second factor that sat too long between its two halves. */
export const TOOK_TOO_LONG = 'start again - that took too long'

/** A path the service will not write a note to: one that climbs out of its space,
 *  names a disk, or is not a path at all. */
export const NOT_A_PATH = 'that path is not usable'

/** The account has no room left for what is arriving - a note or a blob. 507,
 *  because it is the storage and not the request that is at fault. */
export const OUT_OF_SPACE = 'out of space'

/** A space that already holds as many people as one may. */
export const SPACE_IS_FULL = 'that is as many people as one space holds'

/** An address that is not one. */
export const NOT_AN_EMAIL = 'enter a valid email address'

/** A blog route reached with no address chosen for the space yet. */
export const NO_ADDRESS = 'choose an address'
