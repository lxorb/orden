export function root(body: () => void): () => void {
  return $effect.root(body)
}

export function watch(run: Parameters<typeof $effect>[0]): void {
  $effect(run)
}

export function computed<T>(of: () => T): () => T {
  const value = $derived.by(of)
  return () => value
}

export function reactive<T extends object>(initial: T): T {
  const fields = $state(initial)
  return fields
}
