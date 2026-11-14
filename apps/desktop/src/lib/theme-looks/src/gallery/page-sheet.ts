import { rules } from './sample'

const SCHEME = /^\[data-theme\s*=\s*['"]?(light|dark)['"]?\s*\]$/

export function pageSheet(css: string): string {
  const shared: string[] = []
  const light: string[] = []
  const dark: string[] = []

  for (const { prelude, body } of rules(css)) {
    const parts = prelude.split(',').map((part) => part.trim())
    const schemes = parts.map((part) => SCHEME.exec(part)?.[1])

    if (!schemes.every(Boolean)) {
      shared.push(`${prelude} {${body}}`)
      continue
    }

    if (schemes.includes('light')) light.push(body)
    if (schemes.includes('dark')) dark.push(body)
  }

  return [
    ...shared,
    ...light.map((body) => `:root {${body}}`),
    ...dark.map(
      (body) => `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {${body}} }`,
    ),
    ...dark.map((body) => `:root[data-theme='dark'] {${body}}`),
    ...light.map((body) => `:root[data-theme='light'] {${body}}`),
    ...light.map((body) => `@media print { :root, :root[data-theme='dark'] {${body}} }`),
  ].join('\n')
}
