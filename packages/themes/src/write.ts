const SURFACE_CLASS = 'nib-write'

const SURFACE = `:is(#write, .${SURFACE_CLASS})`

export function everySurface(css: string): string {
  return css.replace(/:is\(#write, \.nib-write\)|#write(?![\w-])/g, (found) =>
    found === '#write' ? SURFACE : found,
  )
}
