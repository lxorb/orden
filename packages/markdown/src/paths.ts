const FORBIDDEN = /[\\/:*?"<>|]|\p{Cc}/gu

export function withoutForbidden(name: string): string {
  return name.replace(FORBIDDEN, ' ')
}

export function numbered(path: string, counter: number): string {
  if (counter <= 1) return path

  const slash = path.lastIndexOf('/')
  const folder = path.slice(0, slash + 1)
  const file = path.slice(slash + 1)

  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const extension = dot > 0 ? file.slice(dot) : ''

  return `${folder}${stem} ${counter}${extension}`
}

export function freePath(path: string, taken: (candidate: string) => boolean): string {
  for (let counter = 1; ; counter += 1) {
    const candidate = numbered(path, counter)
    if (!taken(candidate)) return candidate
  }
}

export function conflictPath(path: string, on = new Date()): string {
  const stamp = on.toISOString().slice(0, 10)
  const extension = /\.[^./\\]+$/u.exec(path)?.[0] ?? ''
  return `${path.slice(0, path.length - extension.length)} (from another device ${stamp})${extension}`
}
