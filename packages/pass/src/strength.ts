import { WORDS } from './words'

export type Strength = 'vulnerable' | 'weak' | 'strong'

export interface StrengthOf {
  strength: Strength
  bits: number
}

export const STRENGTH_BITS = { weak: 40, strong: 70 } as const

export const COMMON_PASSWORDS: readonly string[] = `123456
password
123456789
12345678
12345
qwerty
1234567
111111
1234567890
123123
abc123
1234
password1
iloveyou
1q2w3e4r
000000
qwerty123
zaq12wsx
dragon
sunshine
princess
letmein
654321
monkey
27653
1qaz2wsx
123321
qwertyuiop
superman
asdfghjkl
football
baseball
welcome
admin
master
shadow
michael
jennifer
jordan
hunter
trustno1
batman
starwars
whatever
freedom
passw0rd
login
access
mustang
charlie
donald
loveme
hello
flower
hottie
secret
summer
winter
spring
autumn
qazwsx
ninja
azerty
solo
abc
password123
admin123
root
toor
changeme
default
guest
test
test123
pass
pass123
qwer
asdf
zxcvbnm
asdfgh
iloveu
lovely
love
monkey123
michelle
daniel
jessica
ashley
amanda
andrew
joshua
thomas
robert
matthew
anthony
william
soccer
hockey
killer
pepper
cheese
cookie
chocolate
banana
orange
purple
silver
golden
diamond
ginger
tigger
buster
maggie
bailey
harley
ranger
thunder
yankees
dallas
chelsea
liverpool
arsenal
barcelona
computer
internet
samsung
google
apple
microsoft
facebook
twitter
youtube
pokemon
minecraft
fortnite
naruto
blink182
metallica
nirvana
matrix
merlin
wizard
dragonball
spiderman
ironman
superstar
sweetheart
angel
babygirl
princess1
iloveyou1
lovelove
forever
friends
family
heaven
jesus
christ
blessed
qwerty1
abcd1234
1qaz
zaq1
zaq1zaq1
q1w2e3r4
1q2w3e
a1b2c3
aa123456
abcdef
abcdefg
abcdefgh
qwertz
qwertzuiop
azertyuiop
passwort
hallo
schatz
geheim
motdepasse
soleil
bonjour
doudou
contrasena
senha
parola
haslo
salasana
wachtwoord
lol123
letmein1
welcome1
monday
friday
sunday
january
august
october
december
starfish
butterfly
rainbow
unicorn
peanut
snoopy
garfield
mickey
minnie
batman1
superman1
hello123
hellokitty
whatever1
nothing
something
mypassword
mypass
yourpassword
secret123
private
qweasd
qweasdzxc
1qazxsw2
asdasd
qweqwe
zxczxc
112233
121212
131313
123654
147258
159753
159357
741852
753951
789456
987654
password12
pa55word
p4ssword`.split('\n')

const KEYBOARD_ROWS = [
  '`1234567890-=',
  'qwertyuiop[]\\',
  "asdfghjkl;'",
  'zxcvbnm,./',
  '1234567890ß´',
  'qwertzuiopü+',
  'asdfghjklöä#',
  'yxcvbnm,.-',
  '²&é"\'(-è_çà)=',
  'azertyuiop^$',
  'qsdfghjklmù*',
  'wxcvbn,;:!',
]

const LEET: Record<string, string> = {
  '4': 'a',
  '@': 'a',
  '8': 'b',
  '(': 'c',
  '3': 'e',
  '6': 'g',
  '9': 'g',
  '1': 'i',
  '!': 'i',
  '|': 'l',
  '0': 'o',
  $: 's',
  '5': 's',
  '7': 't',
  '+': 't',
  '2': 'z',
}

const YEAR = /^(?:19|20)\d\d$/
const LONGEST_BLOCK = 8
const KEYBOARD_BITS = Math.log2(KEYBOARD_ROWS.join('').length * 2)
const SEQUENCE_BITS = Math.log2(62 * 2)
const YEAR_BITS = Math.log2(200)
const WORD_BITS = Math.log2(WORDS.length)

interface Dictionaries {
  common: Map<string, number>
  words: Set<string>
  longest: number
}

let dictionaries: Dictionaries | null = null

function dictionariesOf(): Dictionaries {
  dictionaries ??= {
    common: new Map(COMMON_PASSWORDS.map((one, at) => [one, Math.log2(at + 2)])),
    words: new Set(WORDS.filter((one) => one.length >= 3)),
    longest: [...COMMON_PASSWORDS, ...WORDS].reduce(
      (high, one) => Math.max(high, one.length),
      -Infinity,
    ),
  }
  return dictionaries
}

function poolOf(password: string): number {
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[\x20-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(password)) pool += 33
  if (/[^\x20-\x7e]/.test(password)) pool += 100
  return Math.max(pool, 1)
}

function caseBits(piece: string): number {
  const lower = piece.toLowerCase()
  if (piece === lower) return 0
  if (piece === piece.toUpperCase() || piece === lower.charAt(0).toUpperCase() + lower.slice(1))
    return 1
  return 2
}

function unleeted(lower: string, one: string): string {
  return lower.replace(/./gsu, (char) => (char === '1' ? one : (LEET[char] ?? char)))
}

function readingsOf(lower: string): { text: string; bits: number }[] {
  const readings = [{ text: lower, bits: 0 }]
  for (const one of ['i', 'l']) {
    const text = unleeted(lower, one)
    if (text.length === lower.length && readings.every((reading) => reading.text !== text))
      readings.push({ text, bits: 1 })
  }
  return readings
}

function wordBits(piece: string, dictionaries: Dictionaries): number {
  const common = dictionaries.common.get(piece)
  if (common !== undefined) return common
  return dictionaries.words.has(piece) ? WORD_BITS : Infinity
}

function keyboardRun(lower: string, from: number): number {
  let longest = 1
  for (const row of KEYBOARD_ROWS) {
    const start = row.indexOf(lower.charAt(from))
    if (start < 0) continue
    for (const step of [1, -1]) {
      let length = 1
      while (
        from + length < lower.length &&
        row.charAt(start + step * length) === lower.charAt(from + length) &&
        start + step * length >= 0
      )
        length++
      longest = Math.max(longest, length)
    }
  }
  return longest
}

function sequenceRun(lower: string, from: number): number {
  if (!/[a-z0-9]/.test(lower.charAt(from))) return 1
  let longest = 1
  for (const step of [1, -1]) {
    let length = 1
    while (
      from + length < lower.length &&
      /[a-z0-9]/.test(lower.charAt(from + length)) &&
      lower.charCodeAt(from + length) - lower.charCodeAt(from + length - 1) === step
    )
      length++
    longest = Math.max(longest, length)
  }
  return longest
}

function repeatsOf(password: string, from: number, block: number): number {
  const unit = password.slice(from, from + block)
  let count = 1
  while (password.startsWith(unit, from + count * block)) count++
  return count
}

function cheapestBits(password: string, memo: Map<string, number>): number {
  const known = memo.get(password)
  if (known !== undefined) return known
  const length = password.length
  const lower = password.toLowerCase()
  const charBits = Math.log2(poolOf(password))
  const found = dictionariesOf()
  const readings = readingsOf(lower)
  const cost = new Array<number>(length + 1).fill(Infinity)
  cost[0] = 0
  const offer = (to: number, bits: number, from: number): void => {
    const total = (cost[from] ?? Infinity) + bits
    if (total < (cost[to] ?? Infinity)) cost[to] = total
  }
  for (let from = 0; from < length; from++) {
    offer(from + 1, charBits, from)
    for (let to = from + 3; to <= Math.min(length, from + found.longest); to++) {
      for (const reading of readings) {
        const bits = wordBits(reading.text.slice(from, to), found)
        if (bits < Infinity)
          offer(to, bits + reading.bits + caseBits(password.slice(from, to)), from)
      }
      if (to - from === 4 && YEAR.test(password.slice(from, to))) offer(to, YEAR_BITS, from)
    }
    const keyboard = keyboardRun(lower, from)
    for (let run = 3; run <= keyboard; run++)
      offer(
        from + run,
        KEYBOARD_BITS + Math.log2(run) + caseBits(password.slice(from, from + run)),
        from,
      )
    const sequence = sequenceRun(lower, from)
    for (let run = 3; run <= sequence; run++)
      offer(from + run, SEQUENCE_BITS + Math.log2(run), from)
    for (let block = 1; block <= Math.min(LONGEST_BLOCK, (length - from) / 2); block++) {
      const count = repeatsOf(password, from, block)
      if (count < 2 || (block === 1 && count < 3)) continue
      const unitBits = cheapestBits(password.slice(from, from + block), memo)
      offer(from + block * count, unitBits + Math.log2(count), from)
    }
  }
  const bits = cost[length] ?? 0
  memo.set(password, bits)
  return bits
}

export function strengthOf(password: string): StrengthOf {
  const bits = Math.round(cheapestBits(password, new Map()) * 10) / 10
  const strength: Strength =
    bits >= STRENGTH_BITS.strong && !/^[0-9]*$/.test(password)
      ? 'strong'
      : bits >= STRENGTH_BITS.weak
        ? 'weak'
        : 'vulnerable'
  return { strength, bits }
}
