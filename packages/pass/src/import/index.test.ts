import { describe, expect, it } from 'vitest'
import { SOURCES, SOURCE_IDS, guessSource, importFile, needsZip } from './index'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('SOURCES', () => {
  it('lists every source once with what it takes', () => {
    expect(SOURCES.map((one) => one.id)).toEqual([...SOURCE_IDS])
    for (const one of SOURCES) expect(one.accept.length).toBeGreaterThan(0)
  })

  it('knows which files are archives', () => {
    expect(needsZip('proton', 'Proton Pass.zip')).toBe(true)
    expect(needsZip('proton', 'data.json')).toBe(false)
    expect(needsZip('onepassword', 'x.1PUX')).toBe(true)
    expect(needsZip('onepassword', 'x.1pif')).toBe(false)
    expect(needsZip('dashlane', 'export.zip')).toBe(true)
    expect(needsZip('chrome', 'x.zip')).toBe(false)
  })
})

describe('guessSource', () => {
  it.each([
    ['Chrome Passwords.csv', 'name,url,username,password,note\n', 'chrome'],
    ['Microsoft Edge Passwords.csv', 'name,url,username,password\n', 'edge'],
    ['Brave Passwords.csv', 'name,url,username,password,note\n', 'brave'],
    [
      'logins.csv',
      '"url","username","password","httpRealm","formActionOrigin","guid"\n',
      'firefox',
    ],
    ['Passwords.csv', 'Title,URL,Username,Password,Notes,OTPAuth\n', 'safari'],
    ['1p.csv', 'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\n', 'onepassword'],
    [
      'bw.csv',
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n',
      'bitwarden',
    ],
    ['lp.csv', 'url,username,password,totp,extra,name,grouping,fav\n', 'lastpass'],
    [
      'kx.csv',
      '"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n',
      'keepassxc',
    ],
    [
      'credentials.csv',
      'username,username2,username3,title,password,note,url,category,otpSecret\n',
      'dashlane',
    ],
    ['rf.csv', 'Name,Url,MatchUrl,Login,Pwd,Note,Folder,RfFieldsV2\n', 'roboform'],
    [
      'np.csv',
      'name,url,additional_urls,username,password,note,cardholdername,cardnumber,cvc,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,state,type,custom_fields\n',
      'nordpass',
    ],
    [
      'pp.csv',
      'type,name,url,email,username,password,note,totp,createTime,modifyTime,vault\n',
      'proton',
    ],
    ['other.csv', 'Site,User,Pass\n', 'csv'],
    ['bw.json', '{"encrypted":false,"folders":[],"items":[]}', 'bitwarden'],
    ['data.json', '{"version":"1.0","userId":"u","encrypted":false,"vaults":{}}', 'proton'],
    ['data.pgp', '-----BEGIN PGP MESSAGE-----\n', 'proton'],
    ['keeper.json', '{"shared_folders":[],"records":[]}', 'keeper'],
    [
      'enpass.json',
      '{"folders":[],"items":[{"category":"login","template_type":"login.default"}]}',
      'enpass',
    ],
    ['orden.json', '{"format":"orden-pass","version":1,"vaults":[]}', 'orden'],
    ['kp.xml', '<?xml version="1.0"?>\n<KeePassFile><Root/></KeePassFile>', 'keepass'],
    ['kaspersky.txt', 'Websites\n\nWebsite name: x\nLogin: y\n---\n', 'kaspersky'],
    ['x.1pif', '{"title":"x"}\n***5642bee8-a5ff-11dc-8314-0800200c9a66***\n', 'onepassword'],
    ['x.1pux', '', 'onepassword'],
    ['Dashlane export.zip', '', 'dashlane'],
    ['Proton Pass export.zip', '', 'proton'],
  ])('%s is %s', (name, text, source) => {
    expect(guessSource(name, text)).toBe(source)
  })

  it('is null for what it cannot place', () => {
    expect(guessSource('x.csv', 'a,b\n')).toBeNull()
    expect(guessSource('x.xml', '<html/>')).toBeNull()
    expect(guessSource('x.json', '{"a":1}')).toBeNull()
  })
})

describe('importFile', () => {
  it('reads bytes as UTF-8 without the BOM', () => {
    const bytes = utf8('﻿name,url,username,password,note\nÄ,https://a.com,u,p,\n')
    const result = importFile('chrome', 'x.csv', bytes)
    expect(result.vaults[0]?.items[0]?.content.title).toBe('Ä')
  })

  it('hands an archive to the sources that take one', () => {
    const result = importFile('dashlane', 'x.zip', {
      'securenotes.csv': utf8('title,note\nT,body\n'),
    })
    expect(result.vaults[0]?.items[0]?.content).toMatchObject({ kind: 'note', title: 'T' })
  })

  it('refuses an archive for a source that takes none, and raw bytes of an archive', () => {
    expect(() => importFile('chrome', 'x.csv', { 'a.csv': utf8('') })).toThrow()
    expect(() => importFile('proton', 'x.zip', utf8('PK'))).toThrow()
  })
})
