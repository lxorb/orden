import type { Field } from '../types'
import { Collector, fieldOf, itemOf, loginOf, noteOf } from './build'
import { csvRows } from './csv'
import type { Imported } from './types'

function folderOf(folder: string, name: string): { folder: string; title: string } {
  const path = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (path !== '' || !name.includes('/')) return { folder: path, title: name }
  const at = name.lastIndexOf('/')
  return { folder: name.slice(0, at).replace(/^\/+/, ''), title: name.slice(at + 1) }
}

function rfFieldsOf(cells: readonly string[], login: string, password: string): Field[] {
  const fields: Field[] = []
  for (const cell of cells) {
    const parts = cell.split(',')
    if (parts.length < 5) continue
    const name = (parts[0] ?? '').replace(/\$$/, '')
    const type = parts[3] ?? ''
    const value = parts.slice(4).join(',')
    if (value === '' || value === login || value === password) continue
    fields.push(fieldOf(name, value, type === 'pwd' ? 'hidden' : 'text'))
  }
  return fields
}

export function parseRoboForm(text: string): Imported {
  const into = new Collector('RoboForm')
  const [head, ...rows] = csvRows(text)
  if (!head) return into.result()
  const names = head.map((one) => one.trim().toLowerCase())
  const column = (name: string): number => names.indexOf(name.toLowerCase())
  const at = {
    name: column('Name'),
    url: column('Url'),
    match: column('MatchUrl'),
    login: column('Login'),
    password: column('Pwd'),
    note: column('Note'),
    folder: column('Folder'),
    fields: column('RfFieldsV2'),
  }
  for (const row of rows) {
    const cell = (index: number): string => (index < 0 ? '' : (row[index] ?? ''))
    const { folder, title } = folderOf(cell(at.folder), cell(at.name))
    const login = cell(at.login)
    const password = cell(at.password)
    const url = cell(at.url)
    const note = cell(at.note)
    const fields = at.fields < 0 ? [] : rfFieldsOf(row.slice(at.fields), login, password)
    const content =
      url === '' && login === '' && password === ''
        ? noteOf(title, note, fields)
        : loginOf({ title, username: login, password, urls: [url, cell(at.match)], note, fields })
    into.add(itemOf(content, { folder }))
  }
  return into.result()
}
