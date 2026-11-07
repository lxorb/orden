import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canMakeSshKey, newSshKey, sshComment, sshFingerprint, sshPublicOf } from './ssh'

const ED_PRIVATE = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACB5cKBNA+SIj8ff83+e61qJlnDGsnNuBw1pOLiXX/VjUQAAAJA9X9R+PV/U
fgAAAAtzc2gtZWQyNTUxOQAAACB5cKBNA+SIj8ff83+e61qJlnDGsnNuBw1pOLiXX/VjUQ
AAAEB5cuSBEInnkEgbFm8C8FUYNVRZ7fSCmZNnh6HP8OvMxnlwoE0D5IiPx9/zf57rWomW
cMayc24HDWk4uJdf9WNRAAAACnRlc3RAb3JkZW4BAgM=
-----END OPENSSH PRIVATE KEY-----
`
const ED_PUBLIC =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHlwoE0D5IiPx9/zf57rWomWcMayc24HDWk4uJdf9WNR test@orden'
const ED_PRINT = 'SHA256:G06dMLz14Dh0K2IZLO40np36K/ExRnTDdEXQIDXktxU'

const RSA_PRIVATE = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAlwAAAAdzc2gtcn
NhAAAAAwEAAQAAAIEA0DEIFRHLsYebSkT2UzIqQ7NLo3Un8vvIHMCu06jlzk5TiLVaaiaZ
G7bwjqJjwFLOdNcK92GgrHj/I92+wp7g+2GooePrOsKM2h2m8CY66vbkGtReb5i+TDtIZP
/Nihz/s1h7MX/ZPTmvD1eqMpt/YFhYUsyjVjgNZzYHziBmk9UAAAIAl23L1pdty9YAAAAH
c3NoLXJzYQAAAIEA0DEIFRHLsYebSkT2UzIqQ7NLo3Un8vvIHMCu06jlzk5TiLVaaiaZG7
bwjqJjwFLOdNcK92GgrHj/I92+wp7g+2GooePrOsKM2h2m8CY66vbkGtReb5i+TDtIZP/N
ihz/s1h7MX/ZPTmvD1eqMpt/YFhYUsyjVjgNZzYHziBmk9UAAAADAQABAAAAgGjg+nhawa
mKbfGJMioRMHdwgF806s4eht3tN2VLRZGbpbtN2OF21lS+4QqJxgSh8n2rw0uCNAYO4kE4
ORwkG6O+Ztmi9n9B8HX+hbd6mTTEV/yY5CXIZY/6rHwW+a5x0a55e73Jkn6zGo+uGKbc6y
tkvwo+ozQNYIOaEsewiDA1AAAAQQDAnRSGE2pX5drJ2Wi0jvmeJMiSpPsU4AVzCInsCKXX
8QqyEw6HXUdoc9DPJzu1D0jwfUqTvpUpvo2yiXy1uCmzAAAAQQD55HnCooKiY1pi+yMwuz
0xXwML7D2Xzy2oqR6KN9lhyCv6Dud1lNtX8NmHc8aVRQnEaZVPAhnI3kdQWodfpzcvAAAA
QQDVR6RT/pi35UOI3H79UzTbvrK9q4ATMTJQDsu7fUELu+dW5l/pbyzDDOpeezlW5J1ffR
LZjvJY/NMA4gN1+eQ7AAAACXJzYUBvcmRlbgE=
-----END OPENSSH PRIVATE KEY-----
`
const RSA_PUBLIC =
  'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQDQMQgVEcuxh5tKRPZTMipDs0ujdSfy+8gcwK7TqOXOTlOItVpqJpkbtvCOomPAUs501wr3YaCseP8j3b7CnuD7Yaih4+s6wozaHabwJjrq9uQa1F5vmL5MO0hk/82KHP+zWHsxf9k9Oa8PV6oym39gWFhSzKNWOA1nNgfOIGaT1Q== rsa@orden'
const RSA_PRINT = 'SHA256:wxJCzuqpZi7GNdfm28S8W0g4i+K1cUQuBvVMe1UxCqU'

const EC_PRIVATE = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAaAAAABNlY2RzYS
1zaGEyLW5pc3RwMjU2AAAACG5pc3RwMjU2AAAAQQTfkHwODAD7ev5iLpZmRsoIScFSlJMR
hohRQ8c27L2j9NKAdV0tYeElq5uDF+Q9e5jRBoE7+2UYPYJrrSH0NasfAAAAqKTbH+ik2x
/oAAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBN+QfA4MAPt6/mIu
lmZGyghJwVKUkxGGiFFDxzbsvaP00oB1XS1h4SWrm4MX5D17mNEGgTv7ZRg9gmutIfQ1qx
8AAAAhAOt8OnXB+MqyNcdcFhSqksdbEZc2H6S/8fiTXLndn0igAAAACGVjQG9yZGVuAQID
BAUGBw==
-----END OPENSSH PRIVATE KEY-----
`
const EC_PUBLIC =
  'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBN+QfA4MAPt6/mIulmZGyghJwVKUkxGGiFFDxzbsvaP00oB1XS1h4SWrm4MX5D17mNEGgTv7ZRg9gmutIfQ1qx8= ec@orden'

const LOCKED_PRIVATE = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABAVxq9ajm
lLncwYWngRumabAAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIJQ3vB7f95CQtoP3
P+h1p26hGm10nkyEB7vj2MGxBhh5AAAAkP4HqeswOLDubmAcYifIslPN3KN7yATuqMhyOr
FAgNIMkNJHqcHgCPC7fGkfd2/tEty4PIIYQkLZyBI01+E0Bjtsg5GbXrsa2sJxiH9q/ZnO
7DSqfxacab6fLA1DbWKfAxIqDmC8/muJI9cFlmAsWzt9FdzsrB4mkINRKLOTgchNsbT5lV
O75uH9QG4ZRHe7GA==
-----END OPENSSH PRIVATE KEY-----
`
const LOCKED_PUBLIC =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJQ3vB7f95CQtoP3P+h1p26hGm10nkyEB7vj2MGxBhh5'

function keygen(): boolean {
  try {
    execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' })
    return true
  } catch (error) {
    return (error as { status?: number }).status !== undefined
  }
}

describe('an OpenSSH private key', () => {
  it('gives the public key ssh-keygen gives', () => {
    expect(sshPublicOf(ED_PRIVATE)).toBe(ED_PUBLIC)
    expect(sshPublicOf(RSA_PRIVATE)).toBe(RSA_PUBLIC)
    expect(sshPublicOf(EC_PRIVATE)).toBe(EC_PUBLIC)
  })

  it('locked by a passphrase gives its public key without the comment it hides', () => {
    expect(sshPublicOf(LOCKED_PRIVATE)).toBe(LOCKED_PUBLIC)
  })

  it('that is not one gives nothing', () => {
    expect(sshPublicOf('')).toBeNull()
    expect(sshPublicOf('hello')).toBeNull()
    expect(sshPublicOf(ED_PRIVATE.replace('AAAAB', 'AAAAC'))).toBeNull()
    expect(sshPublicOf(ED_PRIVATE.replace('BAgM=', 'BAgQ='))).toBeNull()
  })
})

function withComment(comment: string): string {
  const body = ED_PRIVATE.split('\n').slice(1, -2).join('')
  const bytes = Buffer.from(body, 'base64')
  const at = bytes.indexOf(Buffer.from('test@orden'))
  Buffer.from(comment, 'latin1').copy(bytes, at)
  const lines = bytes.toString('base64').match(/.{1,70}/g) ?? []
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`
}

describe('a key’s comment', () => {
  it('loses line breaks and control characters, so it stays on one line', () => {
    expect(sshComment('a\nb\r\nc\u0007d\u2028e\u200ef  ')).toBe('a b c d e f')
    const line = sshPublicOf(withComment('te\nst\u0007orde'))
    expect(line).toBe(`${ED_PUBLIC.split(' ').slice(0, 2).join(' ')} te st orde`)
    expect(line).not.toContain('\n')
  })

  it('made into a new key is kept clean too', async () => {
    if (!(await canMakeSshKey())) return
    const made = await newSshKey('me\nssh-rsa AAAA evil')
    expect(made.publicKey.split('\n')).toHaveLength(1)
    expect(made.publicKey.endsWith(' me ssh-rsa AAAA evil')).toBe(true)
    expect(sshPublicOf(made.privateKey)).toBe(made.publicKey)
  })
})

describe('a fingerprint', () => {
  it('is the one ssh-keygen -l prints', async () => {
    expect(await sshFingerprint(ED_PUBLIC)).toBe(ED_PRINT)
    expect(await sshFingerprint(RSA_PUBLIC)).toBe(RSA_PRINT)
    expect(await sshFingerprint(`  ${ED_PUBLIC.split(' ').slice(0, 2).join(' ')}\n`)).toBe(ED_PRINT)
  })

  it('is nothing for a line that is not a key', async () => {
    expect(await sshFingerprint('')).toBeNull()
    expect(await sshFingerprint('ssh-ed25519')).toBeNull()
    expect(await sshFingerprint('ssh-rsa AAAAC3NzaC1lZDI1NTE5AAAAIHlwoE0D5IiPx9')).toBeNull()
    expect(await sshFingerprint(ED_PUBLIC.replace('ssh-ed25519', 'ssh-rsa'))).toBeNull()
  })
})

describe('a new key', () => {
  it('is an Ed25519 pair in OpenSSH form', async () => {
    expect(await canMakeSshKey()).toBe(true)
    const made = await newSshKey(' me@orden ')
    expect(made.publicKey).toMatch(
      /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43} me@orden$/,
    )
    expect(made.privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n')).toBe(true)
    expect(made.privateKey.endsWith('\n-----END OPENSSH PRIVATE KEY-----\n')).toBe(true)
    const lines = made.privateKey.trim().split('\n').slice(1, -1)
    expect(lines.slice(0, -1).every((line) => line.length === 70)).toBe(true)
    expect(sshPublicOf(made.privateKey)).toBe(made.publicKey)
    expect(await sshFingerprint(made.publicKey)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })

  it('without a comment has none', async () => {
    const made = await newSshKey('')
    expect(made.publicKey.split(' ')).toHaveLength(2)
    expect(sshPublicOf(made.privateKey)).toBe(made.publicKey)
  })

  it.skipIf(!keygen())('is read by ssh-keygen as the same key', async () => {
    const made = await newSshKey('check@orden')
    const dir = mkdtempSync(join(tmpdir(), 'pass-ssh-'))
    try {
      const file = join(dir, 'key')
      writeFileSync(file, made.privateKey, { mode: 0o600 })
      const derived = execFileSync('ssh-keygen', ['-y', '-f', file], { encoding: 'utf8' }).trim()
      expect(derived).toBe(made.publicKey)
      writeFileSync(`${file}.pub`, `${made.publicKey}\n`)
      const listed = execFileSync('ssh-keygen', ['-l', '-f', `${file}.pub`], { encoding: 'utf8' })
      expect(listed).toContain(String(await sshFingerprint(made.publicKey)))
      writeFileSync(join(dir, 'message'), 'hello')
      execFileSync('ssh-keygen', ['-Y', 'sign', '-f', file, '-n', 'file', join(dir, 'message')], {
        stdio: 'ignore',
      })
      expect(readFileSync(join(dir, 'message.sig'), 'utf8')).toContain('BEGIN SSH SIGNATURE')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
