let loaded: typeof import('./query-block') | null = null
export async function queryRowsHtml(code: string, nothing: string, root: string | null = null): Promise<string | null> {
  loaded ??= await import('./query-block')
  return loaded.queryRowsHtml(code, nothing, root)
}
export const pressQueryRow = (target: EventTarget | null): boolean => loaded?.pressRow(target) ?? false
