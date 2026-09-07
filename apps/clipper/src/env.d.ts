/// <reference types="vite/client" />

/** The build-time settings this extension reads. Vite types every `VITE_` name
 *  as `any` by default, and an `any` spreading out of `import.meta.env` is how
 *  a missing variable becomes a URL of `undefined` at runtime. */
interface ImportMetaEnv {
  /** Where the sync service lives, for pointing a development build at a local
   *  one. Unset in a normal build, which reaches the hosted service. */
  readonly VITE_NIB_API?: string
}
