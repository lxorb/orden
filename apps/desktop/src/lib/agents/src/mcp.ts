export type McpClient = 'claude' | 'codex' | 'json'

function onWindows(program: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(program) || program.startsWith('\\\\')
}

function quoted(program: string): string {
  if (onWindows(program)) return `"${program}"`
  return /^[\w@%+=:,./-]+$/.test(program) ? program : `'${program.replaceAll("'", `'\\''`)}'`
}

export function mcpLine(program: string, client: McpClient = 'claude'): string {
  if (client === 'json') {
    return JSON.stringify({ mcpServers: { orden: { command: program, args: ['mcp'] } } }, null, 2)
  }
  const add = client === 'claude' ? 'claude mcp add --scope user' : 'codex mcp add'
  return `${add} orden -- ${quoted(program)} mcp`
}
