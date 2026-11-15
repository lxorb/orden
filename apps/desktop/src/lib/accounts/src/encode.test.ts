import { afterEach, describe, expect, test, vi } from 'vitest'
import { carriesMetadata, faceFrom, withoutMetadata } from './encode'

const ascii = (text: string) => Array.from({ length: text.length }, (_, at) => text.charCodeAt(at))
const le32 = (value: number) => [value & 255, (value >> 8) & 255, (value >> 16) & 255, value >>> 24]

function webp(chunks: [string, number[]][]): Uint8Array<ArrayBuffer> {
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

function jpeg(segments: [number, number[]][]): Uint8Array<ArrayBuffer> {
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
  test('carries nothing when it is pixels alone', () => {
    expect(carriesMetadata(webp([['VP8 ', [1, 2, 3, 4]]]))).toBe(false)
    expect(carriesMetadata(jpeg([[0xe0, [...ascii('JFIF'), 0]]]))).toBe(false)
  })

  test('is caught carrying where it was taken', () => {
    expect(
      carriesMetadata(
        webp([
          ['VP8X', [8, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
          ['VP8 ', [1, 2, 3]],
          ['EXIF', GPS],
        ]),
      ),
    ).toBe(true)
    expect(carriesMetadata(jpeg([[0xe1, GPS]]))).toBe(true)
  })

  test('is caught carrying XMP', () => {
    expect(carriesMetadata(webp([['XMP ', ascii('<x:xmpmeta/>')]]))).toBe(true)
  })

  test('that is neither format is not one this app made', () => {
    expect(carriesMetadata(new Uint8Array([0x89, ...ascii('PNG')]))).toBe(true)
  })
})

const ICC = [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9]
const XMP = [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta/>')]
const ADOBE = [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]
const TABLES = [0, ...Array.from({ length: 64 }, (_, at) => at + 1)]

describe('a picture with its metadata taken out', () => {
  test('a JPEG loses Exif, XMP, IPTC and comments and keeps JFIF, its colour profile and its tables', () => {
    const stripped = withoutMetadata(
      jpeg([
        [0xe0, [...ascii('JFIF'), 0, 1, 1]],
        [0xe1, GPS],
        [0xe2, ICC],
        [0xe1, XMP],
        [0xe2, [...ascii('MPF'), 0, 1, 2]],
        [0xed, [...ascii('Photoshop 3.0'), 0, 1]],
        [0xee, ADOBE],
        [0xfe, ascii('taken at home')],
        [0xdb, TABLES],
      ]),
    )
    expect(stripped).toEqual(
      jpeg([
        [0xe0, [...ascii('JFIF'), 0, 1, 1]],
        [0xe2, ICC],
        [0xee, ADOBE],
        [0xdb, TABLES],
      ]),
    )
    expect(carriesMetadata(stripped)).toBe(false)
  })

  test('a JPEG keeps every byte from the start of its scan, even ones that look like markers', () => {
    const scan = [0xff, 0xda, 0, 2, 0xff, 0xe1, 0, 4, 1, 2, 0xff, 0xd9]
    const picture = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 7, 7, ...scan])
    expect(withoutMetadata(picture)).toEqual(new Uint8Array([0xff, 0xd8, ...scan]))
  })

  test('a WebP loses its EXIF and XMP chunks and the flags that announced them', () => {
    const stripped = withoutMetadata(
      webp([
        ['VP8X', [0x20 | 0x10 | 0x08 | 0x04, 0, 0, 0, 95, 0, 0, 95, 0, 0]],
        ['ICCP', [1, 2, 3]],
        ['ALPH', [4, 5]],
        ['VP8 ', [6, 7, 8, 9]],
        ['EXIF', GPS],
        ['XMP ', ascii('<x:xmpmeta/>')],
      ]),
    )
    expect(stripped).toEqual(
      webp([
        ['VP8X', [0x20 | 0x10, 0, 0, 0, 95, 0, 0, 95, 0, 0]],
        ['ICCP', [1, 2, 3]],
        ['ALPH', [4, 5]],
        ['VP8 ', [6, 7, 8, 9]],
      ]),
    )
    expect(carriesMetadata(stripped)).toBe(false)
  })

  test('a picture without metadata comes out the same', () => {
    const plainJpeg = jpeg([
      [0xe0, [...ascii('JFIF'), 0]],
      [0xdb, TABLES],
    ])
    const plainWebp = webp([['VP8 ', [1, 2, 3]]])
    expect(withoutMetadata(plainJpeg)).toEqual(plainJpeg)
    expect(withoutMetadata(plainWebp)).toEqual(plainWebp)
  })

  test('bytes in neither format are left for the guard to refuse', () => {
    const png = new Uint8Array([0x89, ...ascii('PNG')])
    expect(withoutMetadata(png)).toEqual(png)
    expect(carriesMetadata(withoutMetadata(png))).toBe(true)
  })
})

describe('a face drawn where the canvas cannot make WebP and its JPEG carries Exif', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('is still worn, without the Exif', async () => {
    const madeByWebKit = jpeg([
      [0xe0, [...ascii('JFIF'), 0, 1, 1]],
      [0xe1, GPS],
      [0xdb, TABLES],
    ])
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => undefined, imageSmoothingQuality: 'low' }),
      toBlob: (done: (blob: Blob | null) => void, type: string) => {
        done(
          type === 'image/jpeg'
            ? new Blob([madeByWebKit], { type: 'image/jpeg' })
            : new Blob([new Uint8Array([0x89, ...ascii('PNG')])], { type: 'image/png' }),
        )
      },
    }
    vi.stubGlobal('document', { createElement: () => ({ ...canvas }) })

    const picture = { ...canvas, width: 200, height: 200 } as unknown as HTMLCanvasElement
    const { s, l } = await faceFrom(picture, { zoom: 1, offset: { x: 0, y: 0 } }, 200)

    for (const face of [s, l]) {
      expect(face.type).toBe('image/jpeg')
      const bytes = new Uint8Array(face.bytes)
      expect(carriesMetadata(bytes)).toBe(false)
      expect(bytes).toEqual(
        jpeg([
          [0xe0, [...ascii('JFIF'), 0, 1, 1]],
          [0xdb, TABLES],
        ]),
      )
    }
  })
})
