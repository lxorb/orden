const OLD = /(?<![\w-])(\.nib-|--nib-)(?=[a-z0-9])/g

export function carriedCss(css: string): string {
  return css.replace(OLD, (old) => (old.startsWith('.') ? '.orden-' : '--orden-'))
}

export function carriedToken(token: string): string {
  return token.replace(/^--nib-/, '--orden-')
}
