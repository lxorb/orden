/** Lucide's icons, one file each.
 *
 *  The library's index re-exports every icon there is, so importing one from it
 *  would pull the whole set into everything that touches this package - the
 *  Worker that publishes a note included. The single-icon paths are how the app
 *  draws its own icons too; see apps/desktop/src/lib/canvas/lucide.d.ts, which
 *  says the same thing for the same reason. The package ships no types for
 *  those paths, which is all this is. */
declare module 'lucide/dist/esm/icons/*.mjs' {
  const icon: import('lucide').IconNode
  export default icon
}
