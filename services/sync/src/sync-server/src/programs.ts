const OPEN_TO_PROGRAMS: readonly { method: string; path: RegExp; reads?: true }[] = [
  { method: 'GET', path: /^\/v1\/spaces$/ },
  { method: 'GET', path: /^\/v1\/spaces\/(?!available\/)[^/]+\/changes$/ },
  { method: 'GET', path: /^\/v1\/notes\/[^/]+$/ },
  { method: 'PUT', path: /^\/v1\/notes\/[^/]+$/ },
  { method: 'POST', path: /^\/v1\/spaces\/[^/]+\/notes$/ },
  { method: 'GET', path: /^\/v1\/notes\/[^/]+\/versions$/ },
  { method: 'GET', path: /^\/v1\/notes\/[^/]+\/versions\/[^/]+$/ },
  { method: 'POST', path: /^\/v1\/spaces\/[^/]+\/rollback$/ },
  { method: 'GET', path: /^\/v2\/spaces\/[^/]+\/feed$/ },
  { method: 'POST', path: /^\/v2\/docs\/pull$/, reads: true },
]

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function programMayReach(method: string, path: string, readOnly: boolean): boolean {
  return OPEN_TO_PROGRAMS.some(
    (one) =>
      one.method === method &&
      one.path.test(path) &&
      !(readOnly && WRITES.has(method) && !one.reads),
  )
}
