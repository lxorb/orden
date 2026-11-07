const TRAILING = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/

const MARKED = '?!.,:;*_\'"~)'

const MARKS = new Set(Array.from({ length: MARKED.length }, (_, at) => MARKED.charCodeAt(at)))

const OPEN = 40

const CLOSE = 41

const AMPERSAND = 38

const SEMICOLON = 59

function plain(code: number): boolean {
  return !MARKS.has(code) && code !== OPEN && code !== AMPERSAND
}

function alphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

interface Stop {
  at: number
  run: number
}

function read(text: string, from: number, end: number, starts: number[]): Stop {
  let at = from
  while (at < end) {
    const code = text.charCodeAt(at)
    if (plain(code)) {
      starts.push(at)
      do at++
      while (at < end && plain(text.charCodeAt(at)))
    } else if (code === OPEN) {
      let close = at + 1
      while (close < end && text.charCodeAt(close) !== CLOSE) close++
      if (close === end) return { at, run: -1 }
      starts.push(at)
      at = close + 1
    } else if (code === AMPERSAND) {
      let name = at + 1
      while (name < end && alphanumeric(text.charCodeAt(name))) name++
      if (name > at + 1 && name === end - 1 && text.charCodeAt(name) === SEMICOLON) {
        return { at, run: -1 }
      }
      starts.push(at)
      at++
    } else {
      let last = at + 1
      while (last < end && MARKS.has(text.charCodeAt(last))) last++
      if (last < end) {
        starts.push(at)
        at = last
      } else if (last - at > 1) {
        starts.push(at)
        return { at: end - 1, run: at }
      } else return { at, run: -1 }
    }
  }
  return { at: end, run: -1 }
}

function slowly(address: string): string {
  for (let before = ''; before !== address;) {
    before = address
    address = TRAILING.exec(address)?.[0] ?? ''
  }
  return address
}

export function backpedal(address: string): string {
  const starts: number[] = []
  let end = address.length
  let from = 0
  for (;;) {
    const stop = read(address, from, end, starts)
    if (stop.at === end) return address.slice(0, end)
    if (stop.at === 0) return slowly(address.slice(0, end))

    end = stop.run === -1 ? stop.at : stop.run + 1
    let last = starts.length - 1
    while (last > 0 && (starts[last] ?? 0) >= end) last--
    const back = Math.max(0, last - 2)
    from = starts[back] ?? 0
    starts.length = back
  }
}
