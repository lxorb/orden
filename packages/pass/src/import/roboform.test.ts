import { describe, expect, it } from 'vitest'
import { parseRoboForm } from './roboform'

describe('parseRoboForm', () => {
  it('reads logins, folders, extra fields and notes', () => {
    const csv =
      'Name,Url,MatchUrl,Login,Pwd,Note,Folder,RfFieldsV2\n' +
      'Bitwarden,https://bitwarden.com,https://vault.bitwarden.com,user@example.com,password,,/folder1,"User ID$,,,txt,user@example.com","Password$,,,pwd,password","Memorable$,,,pwd,blue, green"\n' +
      'Deep,https://x.com/,https://x.com/,bob,"p""w","a\nb",folder2\\folder3\n' +
      'note - 2023-03-31,,,,,This is a safe note,\n'
    const items = parseRoboForm(csv).vaults[0]?.items ?? []
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      folder: 'folder1',
      content: {
        kind: 'login',
        email: 'user@example.com',
        websites: [{ url: 'https://bitwarden.com/' }, { url: 'https://vault.bitwarden.com/' }],
      },
    })
    expect(items[0]?.content.fields.map((f) => [f.name, f.kind, f.value])).toEqual([
      ['Memorable', 'hidden', 'blue, green'],
    ])
    expect(items[1]).toMatchObject({
      folder: 'folder2/folder3',
      content: { password: 'p"w', note: 'a\nb' },
    })
    expect(items[1]?.content.kind === 'login' && items[1].content.websites).toHaveLength(1)
    expect(items[2]?.content).toMatchObject({ kind: 'note', note: 'This is a safe note' })
  })

  it('takes the folder from the name when there is no folder column', () => {
    const items =
      parseRoboForm('Name,Url,Login,Pwd\n/Work/Mail,https://m.com,u,p\n').vaults[0]?.items ?? []
    expect(items[0]).toMatchObject({ folder: 'Work', content: { title: 'Mail' } })
  })
})
