import { describe, expect, test } from 'vitest'
import { streamLine, usageLine } from './facts'

/** What a tab's hover card says it uses, in developer mode (issue 1063, step 10;
 *  facts.ts): only what is known, a GPU nobody could read left out rather than 0. */

const size = (bytes: number) => `${bytes / 1024} KB`

describe('a tab’s usage', () => {
  test('says the processor, the memory, and the GPU where it is known', () => {
    expect(usageLine({ cpu: 12.4, memory: 2048, gpu: 3.6 }, size)).toBe(
      'CPU 12% · RAM 2 KB · GPU 4%',
    )
    expect(usageLine({ cpu: 150, memory: 1024 }, size)).toBe('CPU 150% · RAM 1 KB')
  })

  test('an application’s stream says only what it has', () => {
    expect(
      streamLine({
        width: 1280,
        height: 800,
        fps: 59.8,
        bitrate: 4_100_000,
        rtt: 3.2,
        encoder: 'libvpx',
      }),
    ).toBe('1280×800 · 60 fps · 4.1 Mb/s · 3 ms · libvpx')
    expect(
      streamLine({ width: null, height: null, fps: null, bitrate: null, rtt: null, encoder: null }),
    ).toBe('')
  })
})
