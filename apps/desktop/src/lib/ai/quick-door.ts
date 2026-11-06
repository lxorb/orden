export function askQuickly(): void {
  if (__EVEN_PLUGIN__) return
  void import('./quick.svelte').then(({ quick }) => quick.show())
}
