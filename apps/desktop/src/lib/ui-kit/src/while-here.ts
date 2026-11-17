import { onDestroy } from 'svelte'

export function whileHere(): <T>(asked: Promise<T>) => Promise<T> {
  let here = true
  onDestroy(() => {
    here = false
  })

  return <T>(asked: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      asked.then(
        (value) => {
          if (here) resolve(value)
        },
        (error: unknown) => {
          if (here) reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
}
