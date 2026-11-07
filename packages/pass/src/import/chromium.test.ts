import { describe, expect, it } from 'vitest'
import { parseBrave, parseChrome, parseEdge } from './chromium'

const CSV =
  '﻿name,url,username,password,note\r\n' +
  'GitHub,https://github.com/login,me@example.com,"pa,ss""word",\r\n' +
  'Bank,https://bank.example.com,jörg,s3cret,"line 1\nline 2"\r\n' +
  ',https://www.example.org/,,,\r\n' +
  ',,,,\r\n'

describe('parseChrome', () => {
  it('reads logins with emails, quotes, newlines and non-ASCII', () => {
    const { vaults, skipped } = parseChrome(CSV)
    expect(skipped).toEqual([])
    expect(vaults.map((v) => v.name)).toEqual(['Chrome'])
    const items = vaults[0]?.items ?? []
    expect(items).toHaveLength(3)
    expect(items[0]?.content).toMatchObject({
      kind: 'login',
      title: 'GitHub',
      email: 'me@example.com',
      username: '',
      password: 'pa,ss"word',
      websites: [{ url: 'https://github.com/login', match: 'domain' }],
    })
    expect(items[1]?.content).toMatchObject({ username: 'jörg', note: 'line 1\nline 2' })
    expect(items[2]?.content).toMatchObject({ title: 'example.org' })
  })

  it('names Edge and Brave', () => {
    expect(parseEdge(CSV).vaults[0]?.name).toBe('Edge')
    expect(parseBrave(CSV).vaults[0]?.name).toBe('Brave')
  })

  it('reads the older export without notes', () => {
    const { vaults } = parseChrome('name,url,username,password\nx,https://x.com,u,p\n')
    expect(vaults[0]?.items[0]?.content).toMatchObject({ title: 'x', username: 'u', password: 'p' })
  })
})
