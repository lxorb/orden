import { afterEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  mac: false,
  printed: [] as (string | Blob)[],
  read: [] as string[],
  revoked: [] as string[],
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => (world.mac ? 'macos' : 'windows'),
  invoke: (command: string, args?: { path?: string }) => {
    const path = args?.path ?? ''
    world.read.push(`${command} ${path}`)
    if (path.includes('missing')) return Promise.reject(new Error('gone'))
    if (command === 'read_file') return Promise.resolve(new TextEncoder().encode(path).buffer)
    if (command === 'read_asset') return Promise.resolve(`data:image/png;base64,${btoa(path)}`)
    return Promise.resolve(undefined)
  },
}))

vi.mock('../export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../export')>()),
  printInFrame: (html: string | Blob) => {
    world.printed.push(html)
    return Promise.resolve()
  },
}))

const { pageWith, printWithPictures, wholeSheet } = await import('./sheet')

const revoke = URL.revokeObjectURL.bind(URL)
URL.revokeObjectURL = (link: string) => {
  world.revoked.push(link)
  revoke(link)
}

const PAGE = '<p><img src="a.png" alt="a"></p><svg><image href="b.jpg"/></svg><img src="a.png">'
const resolve = (src: string) => `/space/${src}`

function printedPage(): string {
  const page = world.printed[0]
  if (typeof page !== 'string') throw new Error('the page was not printed as words')
  return page
}

afterEach(() => {
  world.mac = false
  world.printed = []
  world.read = []
  world.revoked = []
})

describe('printing a page with pictures in a frame', () => {
  test('links every picture of the space instead of writing it into the page', async () => {
    await printWithPictures(PAGE, resolve)

    const page = printedPage()
    expect(page).not.toContain('data:image')
    expect(page.match(/src="blob:/g)).toHaveLength(2)
    expect(page).toMatch(/<image href="blob:/)
    expect(world.read.sort()).toEqual(['read_file /space/a.png', 'read_file /space/b.jpg'])
  })

  test('lets every link go once the print is done', async () => {
    await printWithPictures(PAGE, resolve)

    const links = new Set(printedPage().match(/blob:[^"]+/g))
    expect(links.size).toBe(2)
    expect(new Set(world.revoked)).toEqual(links)
  })

  test('keeps a picture that cannot be read where it was, and the others still print', async () => {
    await printWithPictures('<img src="missing.png"><img src="c.png">', resolve)

    const page = printedPage()
    expect(page).toContain('<img src="missing.png">')
    expect(page).toMatch(/<img src="blob:[^"]+">/)
  })

  test('leaves pictures on the network and already written in alone', async () => {
    const page = '<img src="https://x.test/a.png"><img src="data:image/png;base64,AA==">'
    await printWithPictures(page, resolve)

    expect(world.printed).toEqual([page])
    expect(world.read).toEqual([])
  })

  test('prints the page as it is when there is nothing to find pictures with', async () => {
    await printWithPictures(PAGE, undefined)

    expect(world.printed).toEqual([PAGE])
  })
})

describe('printing a page with pictures on a Mac', () => {
  test('hands over the page in pieces, never as one string', async () => {
    world.mac = true
    await printWithPictures(PAGE, resolve)

    const page = world.printed[0]
    expect(page).toBeInstanceOf(Blob)
    const text = await (page as Blob).text()
    expect(text).toBe(
      PAGE.replaceAll('a.png', `data:image/png;base64,${btoa('/space/a.png')}`).replace(
        'b.jpg',
        `data:image/png;base64,${btoa('/space/b.jpg')}`,
      ),
    )
  })
})

describe('a page with pictures written whole, for a PDF file', () => {
  test('is pieces with each picture written in, never one string', async () => {
    const page = await wholeSheet(PAGE, resolve)

    expect(page).toBeInstanceOf(Blob)
    expect(await (page as Blob).text()).toContain(
      `<img src="data:image/png;base64,${btoa('/space/a.png')}" alt="a">`,
    )
  })

  test('is the page as it is when it holds no picture of the space', async () => {
    expect(await wholeSheet('<p>words</p>', resolve)).toBe('<p>words</p>')
  })
})

describe('a page with its pictures, for an HTML file', () => {
  test('writes each picture in where it is placed', async () => {
    const page = pageWith('<img src="a.png"><img src="https://x.test/b.png"><img src="a.png">', [
      { src: 'a.png', name: 'a.png', mime: 'image/png', bytes: new Uint8Array([1]) },
    ])

    expect(await page.text()).toBe(
      '<img src="data:image/png;base64,AQ=="><img src="https://x.test/b.png"><img src="data:image/png;base64,AQ==">',
    )
  })
})
