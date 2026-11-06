import { describe, expect, it } from 'vitest'
import { crumbsOf, folderName, parentOf, typedFolder } from './crumbs'

describe("a folder's path bar", () => {
  it('is a step a crumb from the top of the disk, on a Mac and Linux', () => {
    expect(crumbsOf('/home/me/Pictures')).toEqual([
      { name: '/', path: '/' },
      { name: 'home', path: '/home' },
      { name: 'me', path: '/home/me' },
      { name: 'Pictures', path: '/home/me/Pictures' },
    ])
  })

  it('starts at the drive on Windows, and at the share on a network', () => {
    expect(crumbsOf('c:\\Users\\me')).toEqual([
      { name: 'C:', path: 'C:\\' },
      { name: 'Users', path: 'C:\\Users' },
      { name: 'me', path: 'C:\\Users\\me' },
    ])
    expect(crumbsOf('\\\\nas\\photos\\2026').map((one) => one.path)).toEqual([
      '\\\\nas\\photos\\',
      '\\\\nas\\photos\\2026',
    ])
  })

  it('names a tab after its folder, and the top of a disk after its crumb', () => {
    expect(folderName('/home/me/Pictures')).toBe('Pictures')
    expect(folderName('/')).toBe('/')
    expect(folderName('D:\\')).toBe('D:')
  })

  it('has a folder above everywhere but the top', () => {
    expect(parentOf('/home/me')).toBe('/home')
    expect(parentOf('/home')).toBe('/')
    expect(parentOf('/')).toBeNull()
    expect(parentOf('C:\\Users')).toBe('C:\\')
    expect(parentOf('C:\\')).toBeNull()
  })
})

describe('a typed location', () => {
  const here = '/home/me/Documents'

  it('is a path from the top of a disk as written, its dots walked', () => {
    expect(typedFolder('/etc/../usr/./share', here, '/home/me')).toBe('/usr/share')
    expect(typedFolder('D:/Photos/../Music', 'C:\\Users', null)).toBe('D:\\Music')
  })

  it('takes ~ as the home folder and anything else from the folder on screen', () => {
    expect(typedFolder('~', here, '/home/me')).toBe('/home/me')
    expect(typedFolder('~/Downloads', here, '/home/me')).toBe('/home/me/Downloads')
    expect(typedFolder('Letters', here, '/home/me')).toBe('/home/me/Documents/Letters')
    expect(typedFolder('..', here, '/home/me')).toBe('/home/me')
    expect(typedFolder('Work', 'C:\\Users\\me', null)).toBe('C:\\Users\\me\\Work')
  })

  it('is nothing for nothing typed, and never climbs above the top', () => {
    expect(typedFolder('   ', here, null)).toBeNull()
    expect(typedFolder('/../../x', here, null)).toBe('/x')
  })
})
