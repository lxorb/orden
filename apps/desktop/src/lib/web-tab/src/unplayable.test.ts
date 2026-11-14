import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'

const script = readFileSync(
  join(import.meta.dirname, '../../../../src-tauri/src/web_media.js'),
  'utf8',
)

const NO_SOURCE = 3

function page(playsH264 = false) {
  const dom = new JSDOM('<video id="one"></video>', { runScripts: 'outside-only' })
  const inside = dom.window as unknown as Window & typeof globalThis & { ordenAsked?: unknown }
  const asked: string[] = []
  inside.ordenAsked = (said: string) => void asked.push(said)
  inside.HTMLMediaElement.prototype.canPlayType = () => (playsH264 ? 'probably' : '')
  inside.eval(script)

  const media = inside.document.getElementById('one') as HTMLVideoElement
  const failed = (message: string) => {
    Object.defineProperty(media, 'error', { value: { code: 4, message } })
    media.dispatchEvent(new inside.Event('error'))
  }
  const sourceFailed = (networkState: number) => {
    const source = inside.document.createElement('source')
    media.append(source)
    Object.defineProperty(media, 'networkState', { value: networkState, configurable: true })
    source.dispatchEvent(new inside.Event('error'))
  }
  return { asked, failed, sourceFailed }
}

const SAID = JSON.stringify(['', 'orden-media-unplayable'])
const NO_DECODER = 'PipelineStatus::DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no streams'

test('a file with no decoder is said', () => {
  const { asked, failed } = page()
  failed(NO_DECODER)
  expect(asked).toEqual([SAID])
})

test('a file that never came is not', () => {
  const { asked, failed } = page()
  failed('MEDIA_ELEMENT_ERROR: Format error')
  expect(asked).toEqual([])
})

test('a source is said only when it was the last', () => {
  const { asked, sourceFailed } = page()
  sourceFailed(2)
  expect(asked).toEqual([])
  sourceFailed(NO_SOURCE)
  expect(asked).toEqual([SAID])
})

test('an engine with the decoder says nothing', () => {
  const { asked, failed, sourceFailed } = page(true)
  failed(NO_DECODER)
  sourceFailed(NO_SOURCE)
  expect(asked).toEqual([])
})
