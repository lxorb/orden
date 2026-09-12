import { describe, expect, test } from 'vitest'
import { sseJson, sseLines, SSE_DONE } from './stream'

/** Feeds a whole stream in pieces of `size` and answers the payloads that came
 *  out, which is what a slow connection does to a provider's reply. */
function inPieces(stream: string, size: number): string[] {
  let held = ''
  const out: string[] = []

  for (let at = 0; at < stream.length; at += size) {
    const { payloads, rest } = sseLines(held, stream.slice(at, at + size))
    held = rest
    out.push(...payloads)
  }

  return out
}

const STREAM =
  'data: {"a":1}\n\ndata: {"b":2}\n\nevent: ping\ndata: {"c":3}\n\n' + `data: ${SSE_DONE}\n\n`

describe('splitting a stream into events', () => {
  test('reads the data lines and ignores the rest', () => {
    expect(inPieces(STREAM, STREAM.length)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}', SSE_DONE])
  })

  test('reads the same events however the chunks fall', () => {
    const whole = inPieces(STREAM, STREAM.length)
    for (const size of [1, 2, 3, 5, 7, 11, 13, 17, 31]) {
      expect(inPieces(STREAM, size), `chunks of ${size}`).toEqual(whole)
    }
  })

  test('keeps a half-arrived line back rather than parsing half of it', () => {
    const { payloads, rest } = sseLines('', 'data: {"a":1')
    expect(payloads).toEqual([])
    expect(rest).toBe('data: {"a":1')
  })

  test('reads a line the server ended with CRLF', () => {
    const { payloads } = sseLines('', 'data: {"a":1}\r\n\r\n')
    expect(payloads).toEqual(['{"a":1}'])
  })

  test('drops a data line with nothing on it', () => {
    expect(sseLines('', 'data:\n\ndata: \n\n').payloads).toEqual([])
  })

  test('never mistakes a comment or an id for data', () => {
    expect(sseLines('', ': keep-alive\nid: 4\nretry: 100\n').payloads).toEqual([])
  })
})

describe('one event as JSON', () => {
  test('parses what a provider sent', () => {
    expect(sseJson('{"a":1}')).toEqual({ a: 1 })
  })

  test('answers nothing for the end of a stream', () => {
    expect(sseJson(SSE_DONE)).toBeNull()
  })

  test('answers nothing for a line that is not JSON', () => {
    expect(sseJson('OK')).toBeNull()
    expect(sseJson('{"half":')).toBeNull()
  })
})
