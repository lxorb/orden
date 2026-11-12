import { describe, expect, test } from 'vitest'
import { cloudInit, sshKeyOf } from '../src/sync-server-machines/src/machines/cloudinit'

const SECRET = 'f'.repeat(64)
const TUNNEL = 'eyJhIjoiYWNjb3VudCIsInQiOiJ0dW5uZWwiLCJzIjoic2VjcmV0In0='
const BUNDLE = 'b'.repeat(64)
const KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK0wmN/Cr3JXqmLW7u+g9pTh+wyqDHpSQEIQczXkVx9q emil@laptop'

const boot = {
  secret: SECRET,
  tunnel: TUNNEL,
  zone: 'Europe/Zurich',
  origin: 'https://nibeditor.com/anything',
  bundle: BUNDLE,
  sshKey: null,
}

const redacted = (text: string) =>
  text.replaceAll(SECRET, '<ordend secret>').replaceAll(TUNNEL, '<tunnel token>')

describe('cloud-init', () => {
  test('as a server gets it, its secrets redacted', () => {
    expect(redacted(cloudInit(boot))).toMatchSnapshot()
  })

  test('the secrets are in files only root reads, and in no command', () => {
    const text = cloudInit(boot)
    const [files = '', commands = ''] = text.split('\nruncmd:\n')
    expect(files.split(SECRET)).toHaveLength(2)
    expect(files.split(TUNNEL)).toHaveLength(2)
    expect(commands).not.toContain(SECRET)
    expect(commands).not.toContain(TUNNEL)
    for (const path of ['/etc/ordend/env', '/etc/cloudflared/env']) {
      expect(files).toContain(`- path: ${path}\n    owner: root:root\n    permissions: '0600'`)
    }
    expect(commands).toContain(`echo '${BUNDLE}  /root/machine.bin' | sha256sum -c -`)
    expect(commands).toContain('https://nibeditor.com/v2/online/machine/' + BUNDLE + '.bin')
    expect(commands).toContain('rm -f /var/lib/cloud/instance/user-data.txt')
    expect(text.length).toBeLessThan(32 * 1024)
  })

  test('an emergency key is written only when there is one, and only a key', () => {
    expect(cloudInit(boot)).not.toContain('ssh_key')
    const keyed = cloudInit({ ...boot, sshKey: KEY })
    expect(keyed).toContain('- path: /etc/ordend/ssh_key')
    expect(keyed).toContain(KEY)
    expect(cloudInit({ ...boot, sshKey: 'rm -rf / #' })).not.toContain('ssh_key')
    expect(sshKeyOf(`${KEY}\nssh-rsa AAAA second`)).toBeNull()
    expect(sshKeyOf(`  ${KEY}  `)).toBe(KEY)
  })

  test('refuses what could break out of its lines', () => {
    expect(() => cloudInit({ ...boot, secret: 'a\nb'.repeat(10) })).toThrow()
    expect(() => cloudInit({ ...boot, tunnel: "x'; rm -rf /; '".repeat(2) })).toThrow()
    expect(() => cloudInit({ ...boot, bundle: 'not a sha' })).toThrow()
    expect(cloudInit({ ...boot, zone: '../../etc/passwd\nx' })).toContain('TZ=UTC')
  })
})
