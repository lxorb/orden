export function whenLoaded<T>(
  load: () => Promise<T>,
  use: (loaded: T) => void,
  missed?: (error: unknown) => void,
): () => void {
  let wanted = true
  const used = load().then((loaded) => {
    if (wanted) use(loaded)
  })
  if (missed)
    void used.catch((error: unknown) => {
      if (wanted) missed(error)
    })
  return () => {
    wanted = false
  }
}
