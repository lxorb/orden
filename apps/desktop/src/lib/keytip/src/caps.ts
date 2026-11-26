const SIGN = /^[⌃⌥⇧⌘]/u
export function capsOf(shown: string): string[] {
  return shown
    .split(' ')
    .filter(Boolean)
    .flatMap((tap) => {
      const caps: string[] = []
      let rest = tap
      while (rest.length > 1 && SIGN.test(rest)) {
        caps.push(rest.slice(0, 1))
        rest = rest.slice(1)
      }
      return caps.length ? [...caps, rest] : rest.split(/\+(?!$)/)
    })
}
