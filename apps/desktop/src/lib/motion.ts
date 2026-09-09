/** How long something may take to move, when it is JavaScript that says.
 *
 *  Everything the stylesheets move reads a `--dur-*` token, and the tokens are
 *  all zeroed together for somebody who has asked their system for as little
 *  movement as possible; see prefers-reduced-motion in tokens.css. A transition
 *  written in a component cannot read a token - Svelte's `fade` and `fly` take a
 *  number of milliseconds - so those durations went through that switch and came
 *  out the other side still moving. This is the same rule for them: one place, so
 *  the app answers the setting with one voice.
 *
 *  Nothing is cached and nothing is watched. Svelte asks for a transition's
 *  parameters at the moment the transition starts, so asking the query then is
 *  both the freshest answer and the cheapest one: turning the setting on
 *  mid-session reaches the next thing that moves. */

const STILL = '(prefers-reduced-motion: reduce)'

/** Guarded so this module can be imported where there is no window: tests
 *  today, and server-side rendering once the web app is prerendered. */
const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(STILL)
    : null

/** Whether the reader has asked for as little movement as the app can manage.
 *  What something that moves by itself rather than by a duration asks: a graph
 *  settling, a line sweeping. */
export function stillness(): boolean {
  return query?.matches ?? false
}

/** The duration a movement is given: the one asked for, or none at all. */
export function dur(ms: number): number {
  return stillness() ? 0 : ms
}
