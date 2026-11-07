import { describe, expect, test } from 'vitest'
import {
  asksFirst,
  imageIn,
  imageKindAt,
  imageKindOf,
  linesIn,
  pasted,
  spokenPath,
  spokenPaths,
} from './paste'

describe('a paste into a terminal', () => {
  test('loses the whitespace after a single line', () => {
    expect(pasted('npm install\n')).toBe('npm install')
    expect(pasted('ls -la  \r\n')).toBe('ls -la')
  })

  test('and keeps a block of lines as it was', () => {
    expect(pasted('cd x\nls\n')).toBe('cd x\nls\n')
    expect(linesIn('cd x\nls\n')).toBe(3)
    expect(linesIn('one line\n')).toBe(1)
  })

  test('a dropped path is spelled for the shell it lands in', () => {
    expect(spokenPath('C:\\Users\\me\\notes', 'pwsh')).toBe('C:\\Users\\me\\notes')
    expect(spokenPath('C:\\Users\\me\\My notes', 'cmd')).toBe('"C:\\Users\\me\\My notes"')
    expect(spokenPath('C:\\Users\\me\\My notes', 'git-bash')).toBe("'/c/Users/me/My notes'")
    expect(spokenPath('C:\\Users\\me\\notes', 'wsl:Ubuntu')).toBe('/mnt/c/Users/me/notes')
    expect(spokenPath("/home/me/it's here", '/bin/zsh')).toBe("'/home/me/it'\\''s here'")
    expect(spokenPath('/home/me/notes.md', '/bin/bash')).toBe('/home/me/notes.md')
  })

  test('a dropped name never runs anything in the shell it lands in', () => {
    expect(spokenPath('C:\\x\\$(calc) `a`.txt', 'pwsh')).toBe("'C:\\x\\$(calc) `a`.txt'")
    expect(spokenPath("C:\\x\\it's $env:HOME", 'powershell')).toBe("'C:\\x\\it''s $env:HOME'")
    expect(spokenPath('/home/me/$(id) `id`.txt', 'ssh:box')).toBe("'/home/me/$(id) `id`.txt'")
  })

  test('a dropped name never closes its quote in fish, PowerShell beside Visual Studio, nu or csh', () => {
    expect(spokenPath("/tmp/x\\';id;#", '/usr/bin/fish')).toBe("'/tmp/x'\\\\\\'';id;#'")
    expect(spokenPath('C:\\x\\$(calc).txt', 'vs-pwsh:66e9e031')).toBe("'C:\\x\\$(calc).txt'")
    expect(spokenPath("/x/it's $(id)", '/opt/microsoft/powershell/7/pwsh')).toBe("'/x/it''s $(id)'")
    expect(spokenPath("/x/a';id;'", '/usr/bin/nu')).toBe("r#'/x/a';id;''#")
    expect(spokenPath('/x/a!1 b', '/bin/tcsh')).toBe("'/x/a'\\!'1 b'")
    expect(spokenPath('/x/a\\b', '/bin/bash')).toBe("'/x/a'\\\\'b'")
  })

  test('a dropped name for a host whose shell is not known is quoted for every shell or left out', () => {
    expect(spokenPath('/x/a b!', 'ssh:box')).toBe("'/x/a b'\\!")
    expect(spokenPath('/x/a&calc', 'ssh:box')).toBeNull()
    expect(spokenPath('/x/a|b', 'ssh:')).toBeNull()
    expect(spokenPath('/x/%PATH%', 'ssh:box')).toBeNull()
    expect(spokenPath('/x/a"b', 'ssh:box')).toBeNull()
    expect(spokenPath('/x/a^b', 'ssh:box')).toBeNull()
    expect(spokenPath("/x/a';touch PWNED;#", 'ssh:box')).toBeNull()
    expect(spokenPath('/x/a,b', 'ssh:box')).toBe("'/x/a,b'")
    expect(spokenPath('/x/plain-1.0+2', 'ssh:box')).toBe('/x/plain-1.0+2')
  })

  test('a name with a percent sign never reaches cmd, which expands it even in quotes', () => {
    expect(spokenPath('C:\\x\\%PATH%.txt', 'cmd')).toBeNull()
    expect(spokenPath('C:\\x\\100%.txt', 'vs-cmd:66e9e031')).toBeNull()
    expect(spokenPath('C:\\x\\a&b.txt', 'cmd')).toBe('"C:\\x\\a&b.txt"')
    expect(spokenPaths(['C:\\a b', 'C:\\%x%', 'C:\\c'], 'cmd')).toEqual({
      said: '"C:\\a b" C:\\c',
      left: 1,
    })
  })

  test('a control character in a dropped name reaches the shell as a wildcard, never as a key', () => {
    expect(spokenPath('/x/a\x01\x1b[201~\rb', '/bin/bash')).toBe("'/x/a'??'[201~'?'b'")
    expect(spokenPath('/x/a\nb', 'pwsh')).toBe("'/x/a?b'")
  })

  test('a paste never carries a key a shell would act on by itself', () => {
    expect(pasted('ls\x1b[201~rm -rf ~')).toBe('ls[201~rm -rf ~')
    expect(pasted('rm -rf ~\x0f')).toBe('rm -rf ~')
    expect(pasted('a\x9b1;2Hb\x7f\x03')).toBe('a1;2Hb')
    expect(pasted('a\tb\r\nc')).toBe('a\tb\r\nc')
    expect(linesIn('one\x0fline')).toBe(1)
  })

  test('a paste of many megabytes is looked through in one pass', () => {
    const large = `${'x'.repeat(8_000_000)}\x1b[201~`
    const began = performance.now()
    expect(pasted(large)).toHaveLength(8_000_005)
    expect(pasted('x'.repeat(8_000_000))).toHaveLength(8_000_000)
    expect(performance.now() - began).toBeLessThan(2000)
  })

  test('asks first only for lines a shell without bracketed paste would run', () => {
    expect(asksFirst('a\nb', false)).toBe(true)
    expect(asksFirst('a\nb', true)).toBe(false)
    expect(asksFirst('just this\n', false)).toBe(false)
  })
})

describe('a picture in a paste', () => {
  const transfer = (text: string, ...types: string[]) =>
    ({
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      files: types.map((type) => ({ type })),
    }) as unknown as DataTransfer

  test('is one an agent reads, by its type or its name', () => {
    expect(imageKindOf('image/png')).toBe('png')
    expect(imageKindOf('IMAGE/JPEG')).toBe('jpeg')
    expect(imageKindOf('image/svg+xml')).toBeNull()
    expect(imageKindAt('Pictures/shot.PNG')).toBe('png')
    expect(imageKindAt('a/b.jpg')).toBe('jpeg')
    expect(imageKindAt('a/b.webp')).toBe('webp')
    expect(imageKindAt('notes.md')).toBeNull()
    expect(imageKindAt('png')).toBeNull()
  })

  test('is the paste only where there is no text', () => {
    expect(imageIn(transfer('', 'image/png'))?.type).toBe('image/png')
    expect(imageIn(transfer('', 'text/html', 'image/gif'))?.type).toBe('image/gif')
    expect(imageIn(transfer('words', 'image/png'))).toBeNull()
    expect(imageIn(transfer('', 'application/pdf'))).toBeNull()
    expect(imageIn(null)).toBeNull()
  })
})
