/** A `?raw` import is Vite handing back the file's text rather than loading it
 *  as a stylesheet, which is how `raw.ts` gets the CSS an export bakes into the
 *  document it writes.
 *
 *  Declared here rather than taken from `vite/client`: this package is only
 *  ever compiled as part of whatever bundles it, so it has no build tooling of
 *  its own to depend on, and one line says all the compiler needs to know. */
declare module '*.css?raw' {
  const text: string
  export default text
}
