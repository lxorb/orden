/** Lucide's icons, one file each.
 *
 *  The library's index re-exports every icon there is, and `icons.ts` loads that
 *  index on purpose: lazily, when the icon picker opens, because the whole set is
 *  larger than the app around it. Anything that imports one icon from the index
 *  statically drags the entire set into the first chunk the app loads and takes
 *  the picker's lazy chunk with it, so the icons the interface itself is drawn with
 *  come out of their own files instead. The package ships no types for those paths,
 *  which is all this says. */
declare module 'lucide/dist/esm/icons/*.mjs' {
  const icon: import('lucide').IconNode
  export default icon
}
