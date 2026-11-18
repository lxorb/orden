export const pans = (tool: string, onPage: boolean, writable: boolean): boolean =>
  tool === 'hand' || !onPage || !writable
