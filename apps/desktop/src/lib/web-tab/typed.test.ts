import { describe, expect, test } from 'vitest'
import { dotCom, isLocalFile, mayBeSecret, typedAddress, webAddress } from './typed'

/** Ctrl+Enter in the address field, which every browser has had for thirty years. */
describe('the dot-com press', () => {
  test('makes one word a site', () => {
    expect(dotCom('svelte')).toBe('https://www.svelte.com')
    expect(dotCom('  example  ')).toBe('https://www.example.com')
  })

  test('leaves anything that already reads as an address to the ordinary press', () => {
    expect(dotCom('svelte.dev')).toBe(null)
    expect(dotCom('https://svelte.dev')).toBe(null)
    expect(dotCom('localhost:1425')).toBe(null)
    expect(dotCom('svelte docs')).toBe(null)
    expect(dotCom('a/b')).toBe(null)
    expect(dotCom('')).toBe(null)
  })
})

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
  })

  test('a known web scheme with no slashes is that address, as in a browser', () => {
    expect(webAddress('http:example.com')).toBe('http://example.com/')
    expect(webAddress('https:example.com/a')).toBe('https://example.com/a')
  })

  test('an address is taken as written', () => {
    expect(webAddress('https://svelte.dev/docs')).toBe('https://svelte.dev/docs')
    expect(webAddress('http://localhost:5173/')).toBe('http://localhost:5173/')
  })

  test('a scheme no tab opens means nothing rather than a search', () => {
    expect(webAddress('javascript:alert(1)')).toBeNull()
    expect(webAddress('file:///etc/passwd')).toBeNull()
  })

  test('a host is given https', () => {
    expect(webAddress('svelte.dev')).toBe('https://svelte.dev')
    expect(webAddress('svelte.dev/docs?a=1#b')).toBe('https://svelte.dev/docs?a=1#b')
    expect(webAddress('//svelte.dev')).toBe('https://svelte.dev')
    expect(webAddress('example.com:443/a')).toBe('https://example.com:443/a')
  })

  /** Emil, 2026-10-13 (#235): `localhost:8765` was tried over https alone. Chrome goes to
   *  this machine and the network it is on over plain http, and to a port of its own. */
  test('this machine, the network and a port of its own are given http', () => {
    expect(webAddress('localhost:8765')).toBe('http://localhost:8765')
    expect(webAddress('localhost')).toBe('http://localhost')
    expect(webAddress('localhost/a?b')).toBe('http://localhost/a?b')
    expect(webAddress('app.localhost:5173')).toBe('http://app.localhost:5173')
    expect(webAddress('127.0.0.1:8765')).toBe('http://127.0.0.1:8765')
    expect(webAddress('127.0.0.1')).toBe('http://127.0.0.1')
    expect(webAddress('[::1]:3000')).toBe('http://[::1]:3000')
    expect(webAddress('192.168.1.1')).toBe('http://192.168.1.1')
    expect(webAddress('10.0.0.5/admin')).toBe('http://10.0.0.5/admin')
    expect(webAddress('172.20.3.4:9000')).toBe('http://172.20.3.4:9000')
    expect(webAddress('printer.local')).toBe('http://printer.local')
    expect(webAddress('router.lan')).toBe('http://router.lan')
    expect(webAddress('nas:5000')).toBe('http://nas:5000')
    expect(webAddress('example.com:8080')).toBe('http://example.com:8080')
    expect(webAddress('//localhost:8765')).toBe('http://localhost:8765')
  })

  test('a public address is given https', () => {
    expect(webAddress('8.8.8.8')).toBe('https://8.8.8.8')
    expect(webAddress('172.32.0.1')).toBe('https://172.32.0.1')
  })

  test('a scheme typed is kept as typed', () => {
    expect(webAddress('http://example.com')).toBe('http://example.com')
    expect(webAddress('https://localhost:8765')).toBe('https://localhost:8765')
  })

  test('a word with digits after it is a host only when it is not a scheme', () => {
    expect(webAddress('tel:123')).toBeNull()
    expect(webAddress('nas')).toBe('https://www.google.com/search?q=nas')
  })

  test('words are a search', () => {
    expect(webAddress('svelte docs')).toBe('https://www.google.com/search?q=svelte%20docs')
    // One word with no dot is a word: a browser searches for `svelte` too.
    expect(webAddress('svelte')).toBe('https://www.google.com/search?q=svelte')
  })

  test('on the engine the reader chose', () => {
    expect(webAddress('a & b', 'https://duckduckgo.com/?q=%s')).toBe(
      'https://duckduckgo.com/?q=a%20%26%20b',
    )
    // An address is an address whichever engine searches words.
    expect(webAddress('svelte.dev', 'https://duckduckgo.com/?q=%s')).toBe('https://svelte.dev')
    expect(webAddress('javascript:alert(1)', 'https://duckduckgo.com/?q=%s')).toBeNull()
  })
})

/** A word and a colon is not a scheme because it looks like one: Chrome takes a scheme it
 *  knows, or anything written with `//`, as an address. Of the rest, a phrase is words for
 *  the engine, and what could be a name and a password, or one of them, goes nowhere. */
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
    expect(webAddress(typed)).toBe(
      `https://www.google.com/search?q=${encodeURIComponent(typed.trim())}`,
    )
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

  test.each([
    ['admin:secret@'],
    ['root:hunter2'],
    ['password: hunter2'],
    ['admin:pass word@router.lan'],
  ])('%s is told it went nowhere', (typed) => {
    expect(mayBeSecret(typed)).toBe(true)
  })

  test.each([
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['mailto:me@example.com'],
    ['tel:123'],
    ['about:blank'],
    ['ftp:example'],
    ['nib://history'],
    ['foo://bar'],
    ['chrome://settings'],
  ])('%s is an address no tab opens, and stays out of the search', (typed) => {
    expect(webAddress(typed)).toBeNull()
  })

  test('an address still goes where it says', () => {
    expect(webAddress('view-source:https://example.com')).toBe('view-source:https://example.com')
    expect(webAddress('HTTP://example.com')).toBe('HTTP://example.com')
    expect(webAddress('nas:5000')).toBe('http://nas:5000')
    expect(webAddress('c:8080')).toBe('http://c:8080')
    expect(webAddress('example.com:8080/a')).toBe('http://example.com:8080/a')
    expect(webAddress('[::1]:3000/a')).toBe('http://[::1]:3000/a')
  })

  test('a colon after a host with nothing in the port is still that host', () => {
    expect(webAddress('example.com.:8080')).toBe('http://example.com.:8080')
    expect(webAddress('example.com:/a')).toBe('https://example.com:/a')
    expect(webAddress('www.example.com:')).toBe('https://www.example.com:')
  })
})

/** Nothing on this machine or its network goes to the engine, however it is written. */
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

/** A path on this machine, typed into the bar, is not a host called `c` or `nas`: it would
 *  go out over http, and as words it would go to the search engine. `file:` is not a thing
 *  a tab opens, so it is what `file:///C:/...` typed out is: nothing (#790). */
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

  test('is told from what merely goes nowhere, so the bar can say why', () => {
    expect(isLocalFile('C:\\thesis.pdf')).toBe(true)
    expect(isLocalFile('\\\\nas\\share')).toBe(true)
    expect(isLocalFile('file:///etc/passwd')).toBe(true)
    expect(isLocalFile('javascript:alert(1)')).toBe(false)
    expect(isLocalFile('example.com')).toBe(false)
  })

  test('a host with a backslash after it is still that host', () => {
    expect(webAddress('example.com\\docs')).toBe('https://example.com\\docs')
    expect(webAddress('nas:5000')).toBe('http://nas:5000')
  })
})

/** What is typed is kept in history under the address the page then says it is on. */
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

  test.each([
    '8080:80',
    '0:8080',
    '123:456',
    '2130706433:80',
    '10:30/path',
    '99:99',
    '24:00',
    '9:5',
  ])('%s is a number with a port, and opens', (typed) => {
    expect(webAddress(typed)).toBe(`http://${typed}`)
  })

  test('a word with a port is still a host', () => {
    expect(webAddress('nas:5000')).toBe('http://nas:5000')
    expect(webAddress('host1:5000')).toBe('http://host1:5000')
  })
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
