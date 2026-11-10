export function current(scope: object = globalThis): boolean {
  const has = (name: string, member: string) => {
    const owner: unknown = Reflect.get(scope, name)
    return (
      (typeof owner === 'object' || typeof owner === 'function') &&
      owner !== null &&
      typeof Reflect.get(owner, member) === 'function'
    )
  }

  return has('Promise', 'try') && has('Uint8Array', 'fromBase64') && has('Math', 'sumPrecise')
}

export function decodesImages(agent: string = navigator.userAgent): boolean {
  const webkit = agent.includes('AppleWebKit/') && !/(Chrome|Chromium|CriOS|Edg)\//.test(agent)
  return !webkit
}
