import { describe, expect, test } from 'vitest'
import { Stops } from './startup.svelte'

describe('what a start leaves running', () => {
  test('is stopped once at the end, the last kept first', () => {
    const said: string[] = []
    const stops = new Stops()
    stops.keep(() => said.push('first'))
    stops.keep(() => said.push('second'))

    stops.end()
    stops.end()

    expect(said).toEqual(['second', 'first'])
  })

  test('is stopped at once when it arrives after the end', async () => {
    let stopped = false
    const stops = new Stops()
    const late = Promise.resolve(() => (stopped = true)).then(stops.keep)

    stops.end()
    await late

    expect(stopped).toBe(true)
  })
})
