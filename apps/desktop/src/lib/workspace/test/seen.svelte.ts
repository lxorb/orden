export function seen<T>(read: () => T): { values: T[]; stop: () => void } {
  const values: T[] = []
  const stop = $effect.root(() => {
    $effect(() => {
      values.push(read())
    })
  })
  return { values, stop }
}
