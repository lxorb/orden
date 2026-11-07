import { expect, test } from 'vitest'
import { PIECE, writtenInPieces } from './host'

test('a large write to a mail connection goes in pieces, in order, and an empty one still goes', async () => {
  const bytes = new Uint8Array(PIECE * 2 + 5).map((_, at) => at % 251)
  const sent: Uint8Array[] = []
  await writtenInPieces(bytes, (piece) => {
    sent.push(piece)
    return Promise.resolve()
  })
  expect(sent.map((one) => one.length)).toEqual([PIECE, PIECE, 5])
  const joined = new Uint8Array(bytes.length)
  let at = 0
  for (const one of sent) {
    joined.set(one, at)
    at += one.length
  }
  expect(joined).toEqual(bytes)

  const none: Uint8Array[] = []
  await writtenInPieces(new Uint8Array(0), (piece) => {
    none.push(piece)
    return Promise.resolve()
  })
  expect(none).toEqual([new Uint8Array(0)])
})
