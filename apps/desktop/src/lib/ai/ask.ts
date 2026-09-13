/** What the ```` ```ai ```` block in a note asks, and who answers it.
 *
 *  The editor owns the block: it finds the question, writes the answer under it and
 *  stops a stream that is still coming; see ai/run.ts there. This is the other half
 *  of that seam - which provider, which model, what the model is told, and what a
 *  reader sees when it goes wrong. All of which is answering.ts, fetched by the first
 *  press; this file is only the seam. */

import { setAiRunner } from '@nib/editor'

/** Installed once, at startup, so the glyph on a fence works from the first note.
 *  With no provider set up it still installs: a press then says where to add one,
 *  which is better than a glyph that is not there for reasons nobody can see.
 *
 *  What it installs is a stub. The runner proper - the providers, the keys, the
 *  streaming, the words the model is told - is fetched by the first press, so the
 *  guarantee is kept without any of it being in front of the first paint: the glyph
 *  is there, it answers, and what it costs arrives with the question. See
 *  answering.ts. */
export function installAiRunner() {
  setAiRunner(async (ask, signal) => {
    const { answer } = await import('./answering')
    await answer(ask, signal)
  })
}
