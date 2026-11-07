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
  if (!taken(path)) return path
  const slash = path.lastIndexOf('/')
  const folder = path.slice(0, slash + 1)
  const file = path.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const extension = dot > 0 ? file.slice(dot) : ''
  return `${folder}${freeStem(stem, (one) => taken(`${folder}${one}${extension}`))}${extension}`
}

export function freeName(name: string, taken: (candidate: string) => boolean): string {
  return taken(name) ? freeStem(name, taken) : name
}

const COUNTED = /^(.*\S) ([1-9]\d{0,2})$/su

const STACKED = /^(.*?\S)(?: 2){2,}$/su

export function uncounted(stem: string): string {
  return COUNTED.exec(stem)?.[1] ?? stem
}

function freeStem(stem: string, taken: (candidate: string) => boolean): string {
  const counted = COUNTED.exec(stem)
  const base = counted?.[1] ?? stem
  for (let counter = counted ? Number(counted[2]) + 1 : 2; ; counter += 1) {
    const candidate = `${base} ${counter}`
    if (!taken(candidate)) return candidate
  }
}

export function unstacked(path: string): string {
  const slash = path.lastIndexOf('/')
  const folder = path.slice(0, slash + 1)
  const file = path.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const extension = dot > 0 ? file.slice(dot) : ''
  const stacked = STACKED.exec(stem)
  return stacked ? `${folder}${stacked[1]}${extension}` : path
}

export function conflictPath(path: string, on = new Date()): string {
  const stamp = on.toISOString().slice(0, 10)
  const extension = /\.[^./\\]+$/u.exec(path)?.[0] ?? ''
  return `${path.slice(0, path.length - extension.length)} (from another device ${stamp})${extension}`
}
