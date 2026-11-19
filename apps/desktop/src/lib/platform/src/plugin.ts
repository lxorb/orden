let plugin = false
export function markPlugin(): void {
  plugin = true
}
export const isPlugin = (): boolean => plugin
