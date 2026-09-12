/** The three runes a test needs, in a file the Svelte compiler reads.
 *
 *  A rune is syntax rather than a function: `$effect` exists only in a `.svelte`
 *  file or a `.svelte.ts` one, so a plain `*.effect.test.ts` cannot write one.
 *  Tracking, though, is a runtime matter - reading `said.words` registers a
 *  dependency because the read goes through a getter, whatever file the reading
 *  code was compiled from. So these three are the whole of what a test needs from
 *  the compiler, and the tests themselves stay plain TypeScript. */

/** An effect, and its teardown, outside any component: the cheapest way to ask
 *  what a store does when something is watching it. The returned function stops
 *  watching, and every test that calls this has to call that - an effect left
 *  running is an effect the next test shares.
 *
 *  `body` is called synchronously, which is what lets `watch` below work: a rune
 *  needs a reaction to attach to, and inside here there is one. */
export function root(body: () => void): () => void {
  return $effect.root(body)
}

/** Registers one effect. Only from inside a `root` body, or from a component.
 *
 *  The body's type is Svelte's own - a function, optionally returning its
 *  teardown - taken off `$effect` rather than written out again here, where a
 *  `void` in a union is a lint error and a second spelling of it would be a second
 *  thing to keep in step. */
export function watch(run: Parameters<typeof $effect>[0]): void {
  $effect(run)
}

/** State a plain test file can write to and a component can read as props. A
 *  `$state` object is a proxy: every read of a field through it is tracked and
 *  every write to one is a change, wherever the code doing it lives. */
export function reactive<T extends object>(initial: T): T {
  // Declared and then returned because a rune is syntax: `$state` may only stand
  // where a declaration's value goes.
  const fields = $state(initial)
  return fields
}
