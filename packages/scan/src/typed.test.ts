import { describe, expect, test } from 'vitest'
import { dotCom, isLocalFile, mayBeSecret, typedAddress, unopened, webAddress } from './typed'

describe('what somebody typed', () => {
  test('nothing means nothing', () => {
    expect(webAddress('')).toBeNull()
    expect(webAddress('   ')).toBeNull()
  })

  test('no host ends in a number or has an empty label: those are words', () => {
    const search = (words: string) => `https://www.google.com/search?q=${words}`
    expect(webAddress('3.14')).toBe(search('3.14'))
    expect(webAddress('foo..bar')).toBe(search('foo..bar'))
    expect(webAddress('1.2.3.4')).toBe('https://1.2.3.4')
    expect(webAddress('127.1:3000')).toBe('http://127.1:3000')
  })

  test('a scheme no tab opens means nothing rather than a search', () => {
    expect(webAddress('javascript:alert(1)')).toBeNull()
    expect(webAddress('file:///etc/passwd')).toBeNull()
  })

  test('a word with digits after it is a host only when it is not a scheme', () => {
    expect(webAddress('tel:123')).toBeNull()
    expect(webAddress('nas')).toBe('https://www.google.com/search?q=nas')
  })

  test('on the engine the reader chose', () => {
    expect(webAddress('a & b', 'https://duckduckgo.com/?q=%s')).toBe('https://duckduckgo.com/?q=a%20%26%20b')
    expect(webAddress('svelte.dev', 'https://duckduckgo.com/?q=%s')).toBe('https://svelte.dev')
    expect(webAddress('javascript:alert(1)', 'https://duckduckgo.com/?q=%s')).toBeNull()
  })
})

describe('a name with a dot whose last part is no top-level domain', () => {
  const search = (words: string) => `https://www.google.com/search?q=${encodeURIComponent(words)}`

  test('is a file name, searched for, not a site', () => {
    for (const name of ['node.js', 'vue.config.ts', 'index.html', 'file.txt', 'report.docx', 'a.json'])
      expect(webAddress(name)).toBe(search(name))
  })

  test('is no website the palette offers to open', () => {
    for (const name of ['node.js', 'vite.config.ts', 'notes.txt']) expect(typedAddress(name)).toBeNull()
  })

  test('a real top-level domain, in any case or script, still opens', () => {
    for (const name of ['readme.md', 'svelte.dev', 'x.co', 'Example.COM', 'deno.land', 'foo.zip'])
      expect(webAddress(name)).toBe(`https://${name}`)
    expect(webAddress('例子.中国')).toBe('https://xn--fsqu00a.xn--fiqs8s/')
    expect(webAddress('xn--fsqu00a.xn--fiqs8s')).toBe('https://xn--fsqu00a.xn--fiqs8s')
  })
})

describe('a word with a colon after it', () => {
  test.each([
    ['site:github.com orden'],
    ['TypeError: x is not a function'],
    ['filetype:pdf rust'],
    ['note: buy milk'],
    ['what is this: foo'],
    ['note:'],
    ['http: is a protocol'],
    ['mailto: somebody'],
    ['std::vector'],
    ['C: drive is full'],
  ])('%s is words', (typed) => {
    expect(webAddress(typed)).toBe(`https://www.google.com/search?q=${encodeURIComponent(typed.trim())}`)
    expect(typedAddress(typed)).toBeNull()
    expect(mayBeSecret(typed)).toBe(false)
  })

  test.each([
    ['admin:secret@router.lan'],
    ['admin:pa/ss@router.lan'],
    ['admin:pa?ss@router.lan'],
    ['admin:pass word@router.lan'],
    ['admin:secret@'],
    ['root:hunter2'],
    ['user_1:hunter2'],
    ['password:hunter2'],
    ['password: hunter2'],
    ['Passwd: two words'],
    ['api_key: abc'],
    ['otpauth:totp/x?secret=ABC'],
    ['site:github.com'],
    ['site:github.com/lxorb'],
    ['define:serendipity'],
    ['a:b'],
  ])('%s could be a secret, and stays out of the search', (typed) => {
    expect(webAddress(typed)).toBeNull()
    expect(typedAddress(typed)).toBeNull()
  })

  test.each([['admin:secret@'], ['root:hunter2'], ['password: hunter2'], ['admin:pass word@router.lan']])(
    '%s is told it went nowhere',
    (typed) => {
      expect(mayBeSecret(typed)).toBe(true)
    },
  )

  test.each([
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['mailto:me@example.com'],
    ['tel:123'],
    ['about:blank'],
    ['ftp:example'],
    ['orden://history'],
    ['foo://bar'],
    ['chrome://settings'],
  ])('%s is an address no tab opens, and stays out of the search', (typed) => {
    expect(webAddress(typed)).toBeNull()
  })
})

describe('a local path', () => {
  test.each([
    ['file:notes.txt'],
    ['file: notes.txt'],
    ['FILE:///etc/passwd'],
    ['C:'],
    ['D:thesis.pdf'],
    ['D:my thesis.pdf'],
    ['D:2024.pdf'],
    ['C:Users\\me\\secret.txt'],
    ['C:Users\\my name\\secret.txt'],
    ['C:\\My Documents\\a.txt'],
    ['smb:nas/share'],
    ['smb:nas/my share'],
    ['smb://nas/my share'],
    ['afp:nas/x y'],
    ['nfs:nas/x y'],
    ['/etc/passwd'],
    ['/home/me/my thesis.pdf'],
    ['~/secret.txt'],
    ['./a b.txt'],
    ['../a b.txt'],
  ])('%s stays out of the search, and is said to be a file', (typed) => {
    expect(webAddress(typed)).toBeNull()
    expect(typedAddress(typed)).toBeNull()
    expect(isLocalFile(typed)).toBe(true)
  })

  test('two slashes are a host and not a path', () => {
    expect(isLocalFile('//svelte.dev')).toBe(false)
    expect(webAddress('//svelte.dev')).toBe('https://svelte.dev')
  })
})

describe('a Windows path', () => {
  test.each([
    ['C:\\Users\\emil\\Documents\\thesis.pdf'],
    ['c:\\thesis.pdf'],
    ['C:/Users/emil/thesis.pdf'],
    ['C:\\Users\\emil\\My Documents\\thesis.pdf'],
    ['C:\\Users'],
    ['\\\\nas\\share\\a.txt'],
    ['\\\\nas\\share'],
    ['\\\\nas\\my share\\a.txt'],
    ['\\\\192.168.0.2\\share\\a.txt'],
  ])('%s goes nowhere', (path) => {
    expect(webAddress(path)).toBe(null)
    expect(typedAddress(path)).toBe(null)
  })
})

describe('a name that is not ASCII', () => {
  test('is sent to the address the engine will say', () => {
    expect(webAddress('münchen.de')).toBe('https://xn--mnchen-3ya.de/')
    expect(webAddress('https://münchen.de/a')).toBe('https://xn--mnchen-3ya.de/a')
    expect(typedAddress('münchen.de')).toBe('https://xn--mnchen-3ya.de/')
  })
})

describe('a time of day', () => {
  test.each(['10:30', '9:05', '0:00', '23:59'])('%s is words, not a host and a port', (typed) => {
    expect(typedAddress(typed)).toBeNull()
    expect(mayBeSecret(typed)).toBe(false)
    expect(webAddress(typed)).toBe(`https://www.google.com/search?q=${encodeURIComponent(typed)}`)
  })

  test.each(['8080:80', '0:8080', '123:456', '2130706433:80', '10:30/path', '99:99', '24:00', '9:5'])(
    '%s is a number with a port, and opens',
    (typed) => {
      expect(webAddress(typed)).toBe(`http://${typed}`)
    },
  )
})

describe('a path from where one stands, on Windows', () => {
  test.each([
    ['\\Users\\me\\secret.docx'],
    ['\\Users\\me\\my secret.docx'],
    ['\\secret.txt'],
    ['.\\secret.txt'],
    ['..\\secret dir\\x.txt'],
    ['..\\x.txt'],
    ['~\\x y.txt'],
    ['~\\x.txt'],
  ])('goes to no host and no search engine: %s', (typed) => {
    expect(isLocalFile(typed)).toBe(true)
    expect(typedAddress(typed)).toBeNull()
    expect(webAddress(typed)).toBeNull()
  })
})

describe('a word that names a secret, in the languages a page is read in', () => {
  test.each([
    ['Passwort: geheim'],
    ['Kennwort: geheim'],
    ['passwort:geheim wort'],
    ['Mot de passe: secret'],
    ['contrase\u00f1a: secreto'],
    ['senha: segredo'],
    ['wachtwoord: geheim'],
    ['l\u00f6senord: hemligt'],
    ['\u043f\u0430\u0440\u043e\u043b\u044c: \u0441\u0435\u043a\u0440\u0435\u0442'],
    ['\u5bc6\u7801\uff1a abc'],
    ['\u30d1\u30b9\u30ef\u30fc\u30c9: abc'],
  ])('goes to no search engine: %s', (typed) => {
    expect(mayBeSecret(typed)).toBe(true)
    expect(webAddress(typed)).toBeNull()
  })

  test('and words about one are a search', () => {
    expect(webAddress('passwort vergessen')).toContain('google')
    expect(webAddress('wie lang: passwort')).toContain('google')
  })
})

describe('what Enter does when the bar opens no page', () => {
  test('Orden’s own page opens, as its address is shown', () => {
    expect(webAddress('orden://history')).toBeNull()
    expect(unopened('orden://history')).toBe('own page')
    expect(unopened('  NIB://history ')).toBe('own page')
  })

  test('every other address that opens nothing says so', () => {
    for (const said of [
      'about:blank',
      'chrome://settings',
      'ftp://x.org',
      'mailto:a@b.c',
      'javascript:alert(1)',
      'password: hunter2',
    ]) {
      expect(webAddress(said)).toBeNull()
      expect(unopened(said)).toBe('link')
    }
  })
})

test.each<[unknown, ...Parameters<typeof dotCom>]>([
  ['https://www.svelte.com', 'svelte'],
  ['https://www.example.com', '  example  '],
  [null, 'svelte.dev'],
  [null, 'https://svelte.dev'],
  [null, 'localhost:1425'],
  [null, 'svelte docs'],
  [null, 'a/b'],
  [null, ''],
])('%j from %j', (expected, ...args) => {
  expect(dotCom(...args)).toBe(expected)
})

test.each<[unknown, ...Parameters<typeof isLocalFile>]>([
  [true, 'C:\\thesis.pdf'],
  [true, '\\\\nas\\share'],
  [true, 'file:///etc/passwd'],
  [false, 'javascript:alert(1)'],
  [false, 'example.com'],
])('%j from %j', (expected, ...args) => {
  expect(isLocalFile(...args)).toBe(expected)
})

test.each<[unknown, ...Parameters<typeof unopened>]>([
  ['file', '/etc/hosts'],
  ['file', 'C:\\a.txt'],
  ['nothing', '   '],
])('%j from %j', (expected, ...args) => {
  expect(unopened(...args)).toBe(expected)
})

test.each<[unknown, ...Parameters<typeof webAddress>]>([
  ['http://example.com', 'http:example.com'],
  ['https://example.com/a', 'https:example.com/a'],
  ['https://svelte.dev/docs', 'https://svelte.dev/docs'],
  ['http://localhost:5173/', 'http://localhost:5173/'],
  ['https://svelte.dev', 'svelte.dev'],
  ['https://svelte.dev/docs?a=1#b', 'svelte.dev/docs?a=1#b'],
  ['https://svelte.dev', '//svelte.dev'],
  ['https://example.com:443/a', 'example.com:443/a'],
  ['http://localhost:8765', 'localhost:8765'],
  ['http://localhost', 'localhost'],
  ['http://localhost/a?b', 'localhost/a?b'],
  ['http://app.localhost:5173', 'app.localhost:5173'],
  ['http://127.0.0.1:8765', '127.0.0.1:8765'],
  ['http://127.0.0.1', '127.0.0.1'],
  ['http://[::1]:3000', '[::1]:3000'],
  ['http://192.168.1.1', '192.168.1.1'],
  ['http://10.0.0.5/admin', '10.0.0.5/admin'],
  ['http://172.20.3.4:9000', '172.20.3.4:9000'],
  ['http://printer.local', 'printer.local'],
  ['http://router.lan', 'router.lan'],
  ['http://nas:5000', 'nas:5000'],
  ['http://example.com:8080', 'example.com:8080'],
  ['http://localhost:8765', '//localhost:8765'],
  ['https://8.8.8.8', '8.8.8.8'],
  ['https://172.32.0.1', '172.32.0.1'],
  ['http://example.com', 'http://example.com'],
  ['https://localhost:8765', 'https://localhost:8765'],
  ['https://www.google.com/search?q=svelte%20docs', 'svelte docs'],
  ['https://www.google.com/search?q=svelte', 'svelte'],
  ['http://node.js', 'http://node.js'],
  ['https://node.js/', 'node.js/'],
  ['https://wiki.corp/home', 'wiki.corp/home'],
  ['http://build.server:8080', 'build.server:8080'],
  ['http://printer.lan', 'printer.lan'],
  ['http://nas.local', 'nas.local'],
  ['http://app.localhost', 'app.localhost'],
  ['http://router.home.arpa', 'router.home.arpa'],
  ['view-source:https://example.com', 'view-source:https://example.com'],
  ['HTTP://example.com', 'HTTP://example.com'],
  ['http://nas:5000', 'nas:5000'],
  ['http://c:8080', 'c:8080'],
  ['http://example.com:8080/a', 'example.com:8080/a'],
  ['http://[::1]:3000/a', '[::1]:3000/a'],
  ['http://example.com.:8080', 'example.com.:8080'],
  ['https://example.com:/a', 'example.com:/a'],
  ['https://www.example.com:', 'www.example.com:'],
  ['https://example.com\\docs', 'example.com\\docs'],
  ['http://nas:5000', 'nas:5000'],
  ['http://nas:5000', 'nas:5000'],
  ['http://host1:5000', 'host1:5000'],
])('%j from %j', (expected, ...args) => {
  expect(webAddress(...args)).toBe(expected)
})
