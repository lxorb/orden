const OLD =
  /(?<![\w-])(\.cm-|\.|#|--)nib-(?=[a-z0-9])|(\[\s*(?:class|id)\s*[~|^$*]?=\s*["']?\s*)nib-(?=[a-z0-9])/g

export function carriedCss(css: string): string {
  return css.replace(OLD, (_, lead?: string, named?: string) => `${lead ?? named ?? ''}orden-`)
}

export function carriedToken(token: string): string {
  return token.replace(/^--nib-/, '--orden-')
}
