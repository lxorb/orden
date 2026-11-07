import type { Env } from './types'

function listed(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean)
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function origins(env: Env): string[] {
  const all = [env.APP_ORIGIN, ...listed(env.OTHER_ORIGINS)]
    .map(originOf)
    .filter((one): one is string => one !== null)
  return [...new Set(all)]
}

export function isOwnOrigin(env: Env, origin: string): boolean {
  const asked = originOf(origin)
  return asked !== null && origins(env).includes(asked)
}

export function isAppHost(env: Env, url: string): boolean {
  const asked = originOf(url)
  return asked !== null && origins(env).some((one) => new URL(one).host === new URL(asked).host)
}

export function originAt(env: Env, url: string): string {
  const asked = originOf(url)
  return asked !== null && origins(env).includes(asked) ? asked : (originOf(env.APP_ORIGIN) ?? '')
}

export function blogRoots(env: Env): string[] {
  return [
    ...new Set([env.BLOG_ROOT, ...listed(env.OTHER_BLOG_ROOTS)].map((one) => one.toLowerCase())),
  ]
}

export function blogRootOf(env: Env, hostname: string): string | null {
  const roots = blogRoots(env)
    .filter((root) => hostname === root || hostname.endsWith(`.${root}`))
    .sort((a, b) => b.length - a.length)
  return roots[0] ?? null
}

export function sameOriginPath(pathname: string): string {
  return pathname.replace(/^\/+/, '/')
}
