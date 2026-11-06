export function once<T extends string | boolean, E>(build: (value: T) => E): (value: T) => E {
  const made = new Map<T, E>()

  return (value) => {
    let built = made.get(value)
    if (built === undefined) {
      built = build(value)
      made.set(value, built)
    }
    return built
  }
}
