const OLD = /(?<![\w-])(\.nib-|#nib-|--nib-)(?=[a-z0-9])/g

const NAMED = /(\[\s*(?:class|id)\s*[~|^$*]?=\s*["']?\s*)nib-(?=[a-z0-9])/gi

const NEW: Record<string, string> = { '.nib-': '.orden-', '#nib-': '#orden-', '--nib-': '--orden-' }

export function carriedCss(css: string): string {
  return css.replace(OLD, (old) => NEW[old] ?? old).replace(NAMED, '$1orden-')
}

export function carriedToken(token: string): string {
  return token.replace(/^--nib-/, '--orden-')
}
