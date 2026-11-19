import { describe, expect, test } from 'vitest'
import { isIcon, isTint } from '../src/sync-server-engine/src/spaces/icons'
import { call } from './harness'
import { spaceField } from './space-field'

const { at, put, listed, column, reader, kept, owned } = spaceField('icons')
const DRESSED = { Work: 'Briefcase', 'Work/Ideas': 'folder-open' }
const PNG = 'data:image/png;base64,'
const picture = (length: number) => `${PNG}${'A'.repeat(length - PNG.length - 2)}==`
kept({}, DRESSED, { Work: 'Folder' })
owned({}, DRESSED)
describe("a space's folder icons", () => {
  test('take an emoji, which is what a vault imported from Iconize brings', async () => {
    expect((await put({ Work: '📚', Travel: '🇩🇪' })).status).toBe(200)
    expect(await listed()).toEqual({ Work: '📚', Travel: '🇩🇪' })
  })
})
describe('a picture a folder or a space wears', () => {
  test('is a small PNG kept in the icon itself, up to 2048 characters', () => {
    expect(isIcon(picture(2048))).toBe(true)
    expect(isIcon(`${PNG}iVBORw0KGgo+/A=`)).toBe(true)
    expect(isIcon(picture(2049))).toBe(false)
  })
  test('and never any other kind of data, nor anything that is not base64', () => {
    expect(isIcon('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isIcon('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isIcon('data:image/jpeg;base64,/9j/4AAQ')).toBe(false)
    expect(isIcon('data:image/png,iVBORw0KGgo')).toBe(false)
    expect(isIcon(`${PNG}iVBOR w0KGgo`)).toBe(false)
    expect(isIcon(`${PNG}iVBOR"w0KGgo`)).toBe(false)
    expect(isIcon(`${PNG}iVBORw0KGgo===`)).toBe(false)
    expect(isIcon(`${PNG}iVBORw0KGgo=A`)).toBe(false)
    expect(isIcon(PNG)).toBe(false)
  })
  test('is kept on a folder and read back from the stored map', async () => {
    const set = await put({ Work: picture(2048), Travel: 'data:image/svg+xml;base64,PHN2Zz4=' })
    expect(set.status).toBe(200)
    expect(set.json.icons).toEqual({ Work: picture(2048) })
    expect(await listed()).toEqual({ Work: picture(2048) })
  })
  test('fits on every one of the 400 folders a space dresses', async () => {
    const all = Object.fromEntries(
      Array.from({ length: 400 }, (_, at) => [`Projects/${String(at).padStart(3, '0')} folder`, picture(2048)]),
    )
    expect((await put(all)).status).toBe(200)
    expect(await listed()).toEqual(all)
  })
  test('is kept on the space itself, and taken off again', async () => {
    const patch = (icon: unknown) =>
      call(at.env, `/v1/spaces/${at.space}`, { method: 'PATCH', token: at.token, body: { icon } })
    const set = await patch(picture(2048))
    expect(set.status).toBe(200)
    expect(set.json.space.icon).toBe(picture(2048))
    const space = async () =>
      (await call(at.env, '/v1/spaces', { token: at.token })).json.spaces.find((one) => one.id === at.space)
    expect((await space())?.icon).toBe(picture(2048))
    expect((await patch(picture(2049))).status).toBe(400)
    await patch('data:image/svg+xml;base64,PHN2Zz4=')
    expect((await space())?.icon).toBe(picture(2048))
    expect((await patch(null)).json.space.icon).toBeNull()
  })
})
describe('what a folder may wear', () => {
  test('is an icon name, in either spelling the app writes one', () => {
    expect(isIcon('FileText')).toBe(true)
    expect(isIcon('file-text')).toBe(true)
    expect(isIcon('LiFileText')).toBe(true)
    expect(isIcon('a'.repeat(64))).toBe(true)
    expect(isIcon('a'.repeat(65))).toBe(false)
    expect(isIcon('-')).toBe(false)
  })
  test('or an emoji, however many code points one takes', () => {
    expect(isIcon('📚')).toBe(true)
    expect(isIcon('🇩🇪')).toBe(true)
    expect(isIcon('👩🏽‍🚀')).toBe(true)
    expect(isIcon('🙂'.repeat(9))).toBe(false)
  })
  test('or a set of its own, named in front of it', () => {
    expect(isIcon('flat-color-icons:calendar')).toBe(true)
    expect(isIcon('some-future-set:thing')).toBe(true)
    expect(isIcon('a:b')).toBe(true)
  })
  test('and never a prefix that is not one', () => {
    expect(isIcon('Flat:Calendar')).toBe(false)
    expect(isIcon('set:')).toBe(false)
    expect(isIcon(':name')).toBe(false)
    expect(isIcon('one:two:three')).toBe(false)
    expect(isIcon('C:/notes/rocket')).toBe(false)
  })
  test('and never nothing, nor something a client could read back as a path', () => {
    expect(isIcon('')).toBe(false)
    expect(isIcon('Work/Ideas')).toBe(false)
    expect(isIcon(String.raw`..\..\icon`)).toBe(false)
    expect(isIcon('open folder')).toBe(false)
  })
})
describe('an entry that is not a folder in this space wearing an icon', () => {
  test('is dropped when the path is not inside the space', async () => {
    for (const path of ['/etc', '../secret', 'a/../../b', String.raw`C:\secret`, '']) {
      const set = await put({ [path]: 'Folder', Work: 'Briefcase' })
      expect(set.status, path).toBe(200)
      expect(set.json.icons, path).toEqual({ Work: 'Briefcase' })
    }
  })
  test('takes a path with dots in a name of its own', async () => {
    expect((await put({ 'Work/..hidden': 'Folder' })).json.icons).toEqual({
      'Work/..hidden': 'Folder',
    })
  })
  test('is dropped when the value is not an icon', async () => {
    for (const icon of ['folder open', 'Work/Ideas', 'a'.repeat(65), '', 7, null, { name: 'x' }]) {
      const set = await put({ Bad: icon, Work: 'Briefcase' })
      const said = JSON.stringify(icon)
      expect(set.status, said).toBe(200)
      expect(set.json.icons, said).toEqual({ Work: 'Briefcase' })
    }
  })
  test('leaves the rest of the tree dressed, the map being written whole', async () => {
    await put({ ...DRESSED, '../elsewhere': 'Folder', Travel: 'rm -rf' })
    expect(await listed()).toEqual(DRESSED)
  })
})
describe('a map that is not one', () => {
  test('is refused', async () => {
    expect((await put(['Briefcase'])).status).toBe(400)
    expect((await put('Briefcase')).status).toBe(400)
    expect((await put(null)).status).toBe(400)
    expect((await put(undefined)).status).toBe(400)
  })
  test('says what is wrong with it', async () => {
    expect((await put('Briefcase')).json.error).toBe('icons must be a map')
  })
  test('leaves what was there as it was', async () => {
    await put(DRESSED)
    await put('nonsense')
    expect(await listed()).toEqual(DRESSED)
  })
})
describe('more folder icons than a space holds', () => {
  const many = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, at) => [`${at}`, 'Folder']))
  test('is refused by the count, at the number the app holds itself to', async () => {
    expect((await put(many(400))).status).toBe(200)
    const past = await put(many(401))
    expect(past.status).toBe(400)
    expect(past.json.error).toBe('icons holds at most 400 folders')
  })
  test('is refused by the size, when every entry is legal on its own', async () => {
    const path = (at: number) => `${String(at).padStart(3, '0')}/${'x'.repeat(295)}`
    const deep = Object.fromEntries(Array.from({ length: 400 }, (_, at) => [path(at), picture(2048)]))
    const tints = Object.fromEntries(Array.from({ length: 400 }, (_, at) => [path(at), `a${'b'.repeat(31)}`]))
    expect((await put(deep, { tints })).status).toBe(413)
    expect(await listed()).toEqual({})
  })
})
describe('a column written by a newer build', () => {
  test('is read as far as this one understands it', async () => {
    column(JSON.stringify({ ...DRESSED, '../elsewhere': 'Folder', Travel: 7 }))
    expect(await listed()).toEqual(DRESSED)
  })
  test('is read as nothing when it is not a map at all', async () => {
    column('not json')
    expect(await listed()).toEqual({})
    column('["Work"]')
    expect(await listed()).toEqual({})
    column('7')
    expect(await listed()).toEqual({})
  })
})
describe('the colour a folder’s icon is drawn in', () => {
  const PAINTED = { Work: 'violet', 'Work/Ideas': 'teal' }
  test('starts empty', async () => {
    expect(await listed(at.token, 'tints')).toEqual({})
  })
  test('is written beside the icons and rides the same listing', async () => {
    const set = await put(DRESSED, { tints: PAINTED })
    expect(set.status).toBe(200)
    expect(set.json.tints).toEqual(PAINTED)
    expect(await listed(at.token, 'tints')).toEqual(PAINTED)
    expect(await listed()).toEqual(DRESSED)
  })
  test('is replaced whole, which is how a folder loses its colour', async () => {
    await put(DRESSED, { tints: PAINTED })
    await put(DRESSED, { tints: { Work: 'violet' } })
    expect(await listed(at.token, 'tints')).toEqual({ Work: 'violet' })
  })
  test('goes away when an empty map is sent', async () => {
    await put(DRESSED, { tints: PAINTED })
    await put(DRESSED, { tints: {} })
    expect(await listed(at.token, 'tints')).toEqual({})
  })
  test('stays as it was when a request says nothing about it', async () => {
    await put(DRESSED, { tints: PAINTED })
    const again = await put({ Work: 'Folder' })
    expect(again.json.tints).toEqual(PAINTED)
    expect(await listed(at.token, 'tints')).toEqual(PAINTED)
  })
  test('drops an entry that is not a folder of this space wearing a colour', async () => {
    const set = await put(DRESSED, {
      tints: { Work: 'violet', '../elsewhere': 'teal', Travel: '#ff0000', Deep: 7 },
    })
    expect(set.json.tints).toEqual({ Work: 'violet' })
  })
  test('is refused when it is not a map, and says so', async () => {
    const sent = await put(DRESSED, { tints: ['violet'] })
    expect(sent.status).toBe(400)
    expect(sent.json.error).toBe('tints must be a map')
  })
  test('is refused past the number of folders a space dresses', async () => {
    const many = Object.fromEntries(Array.from({ length: 401 }, (_, at) => [`${at}`, 'violet']))
    expect((await put({}, { tints: many })).status).toBe(400)
  })
  test('is read as far as this build understands a column a newer one wrote', async () => {
    column(JSON.stringify({ ...PAINTED, '../elsewhere': 'violet', Travel: 7 }), 'tints')
    expect(await listed(at.token, 'tints')).toEqual(PAINTED)
    column('not json', 'tints')
    expect(await listed(at.token, 'tints')).toEqual({})
  })
  test('is the space’s, so everybody in it reads the same colours', async () => {
    const theirs = await reader()
    await put(DRESSED, { tints: PAINTED })
    expect(await listed(theirs, 'tints')).toEqual(PAINTED)
  })
  test('is not a reader’s to write, the same as the icons', async () => {
    const theirs = await reader()
    expect((await put(DRESSED, { as: theirs, tints: PAINTED })).status).toBe(403)
    expect(await listed(at.token, 'tints')).toEqual({})
  })
})
describe('what colour a folder may be drawn in', () => {
  test('is an accent’s id', () => {
    expect(isTint('violet')).toBe(true)
    expect(isTint('slate')).toBe(true)
    expect(isTint('some-future-accent')).toBe(true)
  })
  test('and never a colour a machine picked out of its own palette', () => {
    expect(isTint('#ff0000')).toBe(false)
    expect(isTint('rgb(1, 2, 3)')).toBe(false)
    expect(isTint('Violet')).toBe(false)
    expect(isTint('')).toBe(false)
  })
  test('and never anything a client could read back as a path', () => {
    expect(isTint('Work/Ideas')).toBe(false)
    expect(isTint(String.raw`..\..\violet`)).toBe(false)
    expect(isTint('a'.repeat(33))).toBe(false)
  })
})
