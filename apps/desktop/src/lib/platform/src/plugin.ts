let plugin = false

export function markPlugin(): void {
  plugin = true
}

export function isPlugin(): boolean {
  return plugin
}
