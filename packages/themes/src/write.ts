const SURFACE_CLASS = 'orden-write'

const SURFACE = `:is(#write, .${SURFACE_CLASS})`

export function everySurface(css: string): string {
  return css.replace(/:is\(#write, \.orden-write\)|#write(?![\w-])/g, (found) =>
    found === '#write' ? SURFACE : found,
  )
}
