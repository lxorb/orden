const OUTSIDE = /^mcp__([a-z0-9-]{1,24})__(.+)$/
const OWN = new Set(['orden', 'nib'])
const servers = new Map<string, string>()
export function heardTools(tools: readonly { name: string; description: string }[]): void {
  for (const one of tools) {
    const server = /^([^:\n]{1,80}): /.exec(one.description)?.[1]?.trim()
    if (server && OUTSIDE.test(one.name)) servers.set(one.name, server)
  }
}
export function outsideTool(name: string): { tool: string; server: string } | null {
  const [, id = '', tool = ''] = OUTSIDE.exec(name) ?? []
  if (!id || OWN.has(id)) return null
  return { tool, server: servers.get(name) ?? id }
}
