/// <reference types="vite/client" />

/** The build-time settings this app reads. Vite types every `VITE_` name as
 *  `any` by default, and an `any` spreading out of `import.meta.env` is how a
 *  missing variable becomes a URL of `undefined` at runtime. Named here, so the
 *  compiler knows a value may be absent and the code has to say what then. */
interface ImportMetaEnv {
  /** Where the sync service lives, for pointing a development build at a local
   *  one. Unset in a normal build, which sends the app at the hosted service. */
  readonly VITE_NIB_API?: string
  /** Where the theme store's catalogue is served from, for working on a theme
   *  before it is published: a local folder, or the registry's raw files.
   *  Unset in a normal build, which reads it through the sync service. */
  readonly VITE_NIB_THEMES?: string
}
