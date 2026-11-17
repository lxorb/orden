export function pans(tool: string, onPage: boolean, writable: boolean): boolean {
  return tool === 'hand' || !onPage || !writable
}
