import { Facet } from '@codemirror/state'

export const blockNamer = Facet.define<
  (path: string, line: number) => Promise<string | null>,
  (path: string, line: number) => Promise<string | null>
>({ combine: (values) => values[0] ?? (() => Promise.resolve(null)) })
