import { invoke } from '../../platform/src/api'

const OLD = /(?<![\w-])(\.cm-|\.|#|--)nib-(?=[a-z0-9])|(\[\s*(?:class|id)\s*[~|^$*]?=\s*["']?\s*)nib-(?=[a-z0-9])/g
export function carriedCss(css: string): string {
  return css.replace(OLD, (_, lead?: string, named?: string) => `${lead ?? named ?? ''}orden-`)
}
export const themeSheet = (path: string | undefined): Promise<string> =>
  invoke<string>('read_theme', { path }).then(carriedCss)
export const customSheet = (): Promise<string> => invoke<string>('read_custom_css').then(carriedCss)
