import { type ImportBringPort, type McpImportPort, portOf } from '@orden/contracts'

const NOTHING: ImportBringPort = {
  here: () => Promise.resolve(new Set()),
  browser: () => Promise.resolve([]),
  notes: () => Promise.resolve({ picked: false, trouble: null }),
  shared: () => Promise.resolve(null),
  landShared: () => Promise.resolve(null),
}
export function bringing(): ImportBringPort {
  const port = portOf('import.bring')
  return port.ok ? port.value : NOTHING
}
const NO_MCP: McpImportPort = {
  scan: () => Promise.resolve([]),
  importable: () => false,
  picker: () => Promise.reject(new Error('no MCP servers here')),
}
export function mcpImporting(): McpImportPort {
  const port = portOf('import.mcp')
  return port.ok ? port.value : NO_MCP
}
