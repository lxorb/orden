import headless from '@xterm/headless'
import type { IBuffer } from '@xterm/xterm'
import { describe, expect, test } from 'vitest'
import { growth, GROWS_AT_MOST } from '../../../../../../scripts/growth'
import { linksOn, unbroken } from './links'

const { Terminal } = headless

const SIGN_IN =
  'https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e' +
  '&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback' +
  '&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code' +
  '+user%3Amcp_servers&code_challenge=Q2xhdWRlQ29kZUNoYWxsZW5nZVZhbHVlRm9yVGVzdGluZzEy' +
  '&code_challenge_method=S256&state=U3RhdGVWYWx1ZUZvclRlc3RpbmdUaGVTaWduSW5MaW5rMDA5'

async function screen(cols: number, data: string) {
  const term = new Terminal({ cols, rows: 30, allowProposedApi: true })
  await new Promise<void>((resolve) => {
    term.write(data, resolve)
  })
  const buffer: IBuffer = term.buffer.active
  return { buffer, cols }
}

function hardWrapped(text: string, cols: number): string {
  const rows: string[] = []
  for (let at = 0; at < text.length; at += cols) {
    rows.push(`\x1b[2m${text.slice(at, at + cols)}\x1b[22m`)
  }
  return rows.join('\r\n')
}

function rowsOf(text: string, cols: number) {
  return Math.ceil(text.length / cols)
}

describe('an address over several rows', () => {
  for (const cols of [80, 120]) {
    for (const [how, data] of [
      ['soft', `${SIGN_IN}\r\n$ `],
      ['hard', `${hardWrapped(SIGN_IN, cols)}\r\n$ `],
    ] as const) {
      test(`${how}-wrapped at ${String(cols)} columns is one link from every row`, async () => {
        const { buffer } = await screen(cols, data)
        const last = rowsOf(SIGN_IN, cols) - 1
        for (let y = 0; y <= last; y++) {
          expect(linksOn(buffer, cols, y)).toEqual([
            {
              text: SIGN_IN,
              start: { x: 0, y: 0 },
              end: { x: (SIGN_IN.length - 1) % cols, y: last },
            },
          ])
        }
        expect(linksOn(buffer, cols, last + 1)).toEqual([])
      })

      test(`${how}-wrapped at ${String(cols)} columns copies without the breaks`, async () => {
        const { buffer } = await screen(cols, data)
        const end = { x: cols, y: rowsOf(SIGN_IN, cols) - 1 }
        const whole = unbroken(buffer, cols, { x: 0, y: 0 }, end)
        expect(whole).toBe(how === 'hard' ? SIGN_IN : null)
      })
    }
  }

  test('a part of it copies as that part', async () => {
    const cols = 80
    const { buffer } = await screen(cols, hardWrapped(SIGN_IN, cols))
    expect(unbroken(buffer, cols, { x: 70, y: 1 }, { x: 10, y: 2 })).toBe(SIGN_IN.slice(150, 170))
  })
})

describe('rows that are not one address', () => {
  const cols = 40
  const first = 'https://one.example/aaaaaaaaaaaaaaaaaaaa'
  const second = 'https://two.example/bbbbbbbbbbbbbbbbbbbb'

  test('two addresses each a full row stay two', async () => {
    expect(first).toHaveLength(cols)
    const { buffer } = await screen(cols, `${first}\r\n${second}\r\n`)
    expect(linksOn(buffer, cols, 0).map((link) => link.text)).toEqual([first])
    expect(linksOn(buffer, cols, 1).map((link) => link.text)).toEqual([second])
    expect(unbroken(buffer, cols, { x: 0, y: 0 }, { x: cols, y: 1 })).toBeNull()
  })

  test('an address that ends at the edge does not take the sentence under it', async () => {
    const { buffer } = await screen(cols, `${first}\r\nPress Enter to continue\r\n`)
    expect(linksOn(buffer, cols, 0).map((link) => link.text)).toEqual([first])
    expect(linksOn(buffer, cols, 1)).toEqual([])
  })

  test('an address that ends at the edge does not take the prompt under it', async () => {
    for (const prompt of ['me@vm:~/orden$ ', 'root@vm:/# ', 'me@mac%  ']) {
      const { buffer } = await screen(cols, `${first}\r\n${prompt}`)
      expect(linksOn(buffer, cols, 0).map((link) => link.text)).toEqual([first])
      const wrapped = await screen(cols, `${'x'.repeat(cols - 1)} ${first}\r\n${prompt}`)
      expect(linksOn(wrapped.buffer, cols, 1).map((link) => link.text)).toEqual([first])
    }
  })

  test('an address followed by words on its row ends where they begin', async () => {
    const { buffer } = await screen(cols, 'see https://x.example/a for more\r\nok\r\n')
    expect(linksOn(buffer, cols, 0)).toEqual([
      { text: 'https://x.example/a', start: { x: 4, y: 0 }, end: { x: 22, y: 0 } },
    ])
  })

  test('full rows with no address in them are not joined', async () => {
    const { buffer } = await screen(cols, `${'='.repeat(cols)}\r\nhttps://x.example/a\r\n`)
    expect(linksOn(buffer, cols, 1).map((link) => link.start)).toEqual([{ x: 0, y: 1 }])
  })
})

const AWS =
  'https://us-east-1.signin.aws.amazon.com/v1/authorize?response_type=code' +
  '&client_id=arn%3Aaws%3Asignin%3A%3A%3Adevtools%2Fsame-device' +
  '&redirect_uri=http%3A%2F%2F127.0.0.1%3A53121%2Foauth&code_challenge=TmV2ZXJHb25'

function chunks(text: string, width: number): string[] {
  const rows: string[] = []
  for (let at = 0; at < text.length; at += width) rows.push(text.slice(at, at + width))
  return rows
}

function boxed(lines: string[], cols: number): string {
  const inner = cols - 4
  const top = `╭─ Authentication ${'─'.repeat(cols - 20)}╮`
  const bottom = `╰${'─'.repeat(cols - 2)}╯`
  const rows = lines.flatMap((line) => chunks(line, inner))
  return [top, ...rows.map((row) => `│ ${row.padEnd(inner)} │`), bottom].join('\r\n')
}

function hyperlinked(text: string, cols: number): string {
  return chunks(text, cols)
    .map((row) => `\x1b]8;id=a1;${text}\x07\x1b[2m${row}\x1b[22m\x1b]8;;\x07`)
    .join('\r\n')
}

describe('an address a program drew over three rows', () => {
  const cols = 80

  test('inside a bordered panel is one link from every row, without the border', async () => {
    const inner = cols - 4
    expect(rowsOf(AWS, inner)).toBe(3)
    const data = `${boxed(['Open this address to sign in:', AWS], cols)}\r\n$ `
    const { buffer } = await screen(cols, data)
    const end = { x: 2 + ((AWS.length - 1) % inner), y: 4 }
    for (const y of [2, 3, 4]) {
      expect(linksOn(buffer, cols, y)).toEqual([{ text: AWS, start: { x: 2, y: 2 }, end }])
    }
    expect(linksOn(buffer, cols, 1)).toEqual([])
    expect(linksOn(buffer, cols, 5)).toEqual([])
    expect(unbroken(buffer, cols, { x: 2, y: 2 }, { x: end.x + 1, y: 4 })).toBe(AWS)
  })

  test('under an indented tool marker is one link from every row', async () => {
    const width = cols - 5
    const [first = '', ...rest] = chunks(AWS, width)
    expect(rest).toHaveLength(2)
    const data = [`  ⎿  ${first}`, ...rest.map((row) => `     ${row}`), '', '$ '].join('\r\n')
    const { buffer } = await screen(cols, data)
    const end = { x: 5 + ((AWS.length - 1) % width), y: 2 }
    for (const y of [0, 1, 2]) {
      expect(linksOn(buffer, cols, y)).toEqual([{ text: AWS, start: { x: 5, y: 0 }, end }])
    }
  })

  test('sent as a hyperlink on each row is one link from every row', async () => {
    expect(rowsOf(AWS, cols)).toBe(3)
    const { buffer } = await screen(cols, `${hyperlinked(AWS, cols)}\r\n$ `)
    const end = { x: (AWS.length - 1) % cols, y: 2 }
    for (const y of [0, 1, 2]) {
      expect(linksOn(buffer, cols, y)).toEqual([{ text: AWS, start: { x: 0, y: 0 }, end }])
    }
  })

  for (const [how, data] of [
    ['soft', `${AWS}\r\n$ `],
    ['hard', `${hardWrapped(AWS, cols)}\r\n$ `],
  ] as const) {
    test(`${how}-wrapped is one link from every row`, async () => {
      expect(rowsOf(AWS, cols)).toBe(3)
      const { buffer } = await screen(cols, data)
      const end = { x: (AWS.length - 1) % cols, y: 2 }
      for (const y of [0, 1, 2]) {
        expect(linksOn(buffer, cols, y)).toEqual([{ text: AWS, start: { x: 0, y: 0 }, end }])
      }
    })
  }
})

describe('panel rows that are not one address', () => {
  const cols = 40

  test('an address that ends at the border does not take the sentence under it', async () => {
    const address = 'https://one.example/aaaaaaaaaaaaaaaa'
    expect(address).toHaveLength(cols - 4)
    const { buffer } = await screen(cols, boxed([address, 'Press Enter to go on'], cols))
    expect(linksOn(buffer, cols, 1).map((link) => link.text)).toEqual([address])
    expect(linksOn(buffer, cols, 2)).toEqual([])
  })

  test('an address short of the border does not take the word under it', async () => {
    const { buffer } = await screen(cols, boxed(['https://one.example/a', 'continued'], cols))
    expect(linksOn(buffer, cols, 1).map((link) => link.text)).toEqual(['https://one.example/a'])
    expect(linksOn(buffer, cols, 2)).toEqual([])
  })

  test('an address short of the edge does not take the word under it', async () => {
    const { buffer } = await screen(cols, 'see https://one.example/a\r\ncontinued\r\n')
    expect(linksOn(buffer, cols, 0).map((link) => link.text)).toEqual(['https://one.example/a'])
    expect(linksOn(buffer, cols, 1)).toEqual([])
  })

  test('an indented row does not continue an address it does not line up with', async () => {
    const address = `https://one.example/${'a'.repeat(cols - 20)}`
    expect(address).toHaveLength(cols)
    const { buffer } = await screen(cols, `${address}\r\n   continued\r\n`)
    expect(linksOn(buffer, cols, 0).map((link) => link.text)).toEqual([address])
    expect(linksOn(buffer, cols, 1)).toEqual([])
  })
})

test('a long wrapped line costs in step with its rows when the pointer crosses it', async () => {
  const cols = 300
  const lines = new Map<number, Awaited<ReturnType<typeof screen>>>()
  for (const rows of [32, 128]) {
    lines.set(rows, await screen(cols, `https://example.com/${'a'.repeat(cols * rows - 20)}\r\n$ `))
  }
  const ratio = growth((rows) => {
    const shown = lines.get(rows)
    if (!shown) throw new Error(`no screen of ${rows} rows`)
    const end = shown.buffer.length - 2
    const found = linksOn(shown.buffer, cols, end - Math.floor(rows / 2))
    if (found.length !== 1) throw new Error(`found ${found.length} links`)
  }, 32)
  expect(ratio).toBeLessThan(GROWS_AT_MOST)
})
