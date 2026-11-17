import { describe, expect, test } from 'vitest'
import { withoutMetadata } from './encode'

const ascii = (text: string) => Array.from({ length: text.length }, (_, at) => text.charCodeAt(at))
const le32 = (value: number) => [value & 255, (value >> 8) & 255, (value >> 16) & 255, value >>> 24]

function webp(chunks: [string, number[]][]): Uint8Array {
  const body = chunks.flatMap(([name, bytes]) => [
    ...ascii(name),
    ...le32(bytes.length),
    ...bytes,
    ...(bytes.length % 2 ? [0] : []),
  ])
  return new Uint8Array([...ascii('RIFF'), ...le32(body.length + 4), ...ascii('WEBP'), ...body])
}

const GPS = [
  ...ascii('Exif'),
  0,
  0,
  ...ascii('MM'),
  0,
  42,
  0,
  0,
  0,
  8,
  0,
  1,
  0x88,
  0x25,
  ...ascii('N'),
]

function jpeg(segments: [number, number[]][]): Uint8Array {
  const body = segments.flatMap(([marker, bytes]) => [
    0xff,
    marker,
    ((bytes.length + 2) >> 8) & 255,
    (bytes.length + 2) & 255,
    ...bytes,
  ])
  return new Uint8Array([0xff, 0xd8, ...body, 0xff, 0xda, 0, 2, 1, 2, 3])
}

describe('a picture about to leave the device', () => {
  test('is kept as it is when it is pixels alone', () => {
    const plainWebp = webp([['VP8 ', [1, 2, 3, 4]]])
    const plainJpeg = jpeg([[0xe0, [...ascii('JFIF'), 0]]])
    expect(withoutMetadata(plainWebp)).toEqual(plainWebp)
    expect(withoutMetadata(plainJpeg)).toEqual(plainJpeg)
  })

  test('loses what the encoder wrote about where it was taken, and keeps its pixels (#2076)', () => {
    expect(
      withoutMetadata(
        webp([
          ['VP8X', [8, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
          ['VP8 ', [1, 2, 3]],
          ['EXIF', GPS],
        ]),
      ),
    ).toEqual(
      webp([
        ['VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
        ['VP8 ', [1, 2, 3]],
      ]),
    )
    expect(
      withoutMetadata(
        jpeg([
          [0xe0, [...ascii('JFIF'), 0]],
          [0xe1, GPS],
        ]),
      ),
    ).toEqual(jpeg([[0xe0, [...ascii('JFIF'), 0]]]))
  })

  test('loses XMP', () => {
    expect(
      withoutMetadata(
        webp([
          ['VP8 ', [1, 2, 3, 4]],
          ['XMP ', ascii('<x:xmpmeta/>')],
        ]),
      ),
    ).toEqual(webp([['VP8 ', [1, 2, 3, 4]]]))
  })

  test('that is neither format is not one this app made', () => {
    expect(withoutMetadata(new Uint8Array([0x89, ...ascii('PNG')]))).toBeNull()
  })
})
