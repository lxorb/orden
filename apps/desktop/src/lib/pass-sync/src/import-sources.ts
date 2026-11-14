import type { Source, SourceId } from '@orden/pass/import/index'

export interface SourceMark {
  letters: string
  fill: string
  ink: string
}

const MARKS: Record<SourceId, SourceMark> = {
  proton: { letters: 'P', fill: '#6d4aff', ink: '#ffffff' },
  bitwarden: { letters: 'B', fill: '#175ddc', ink: '#ffffff' },
  onepassword: { letters: '1P', fill: '#0572ec', ink: '#ffffff' },
  lastpass: { letters: 'LP', fill: '#d32d27', ink: '#ffffff' },
  chrome: { letters: 'C', fill: '#1a73e8', ink: '#ffffff' },
  edge: { letters: 'E', fill: '#0c8484', ink: '#ffffff' },
  brave: { letters: 'B', fill: '#fb542b', ink: '#ffffff' },
  firefox: { letters: 'F', fill: '#ff7139', ink: '#ffffff' },
  safari: { letters: 'S', fill: '#1d8cf8', ink: '#ffffff' },
  keepass: { letters: 'K', fill: '#2c6db3', ink: '#ffffff' },
  keepassxc: { letters: 'KX', fill: '#5a9a2e', ink: '#ffffff' },
  dashlane: { letters: 'D', fill: '#0e353d', ink: '#ffffff' },
  keeper: { letters: 'K', fill: '#ffc700', ink: '#1c1c1c' },
  roboform: { letters: 'R', fill: '#4a7a2b', ink: '#ffffff' },
  nordpass: { letters: 'N', fill: '#2b7a6f', ink: '#ffffff' },
  enpass: { letters: 'E', fill: '#2a64c5', ink: '#ffffff' },
  kaspersky: { letters: 'K', fill: '#00a88e', ink: '#ffffff' },
  orden: { letters: 'O', fill: '#5b4be0', ink: '#ffffff' },
  csv: { letters: 'CSV', fill: '#5f6b7a', ink: '#ffffff' },
}

const PLACES: Record<Exclude<SourceId, 'csv'>, { place: string; format: string }> = {
  proton: { place: 'Settings › Export', format: 'ZIP' },
  bitwarden: { place: 'Tools › Export vault', format: 'JSON' },
  onepassword: { place: 'File › Export', format: '1PUX' },
  lastpass: { place: 'Advanced options › Export', format: 'CSV' },
  chrome: { place: 'Google Password Manager › Settings › Export passwords', format: 'CSV' },
  edge: { place: 'Settings › Passwords › Export passwords', format: 'CSV' },
  brave: { place: 'Password Manager › Settings › Export passwords', format: 'CSV' },
  firefox: { place: 'Passwords › Export passwords', format: 'CSV' },
  safari: { place: 'Passwords › File › Export All Passwords', format: 'CSV' },
  keepass: { place: 'File › Export › KeePass XML (2.x)', format: 'XML' },
  keepassxc: { place: 'Database › Export › CSV File', format: 'CSV' },
  dashlane: { place: 'Settings › Export data', format: 'CSV' },
  keeper: { place: 'Settings › Export', format: 'JSON' },
  roboform: { place: 'Options › Account & Data › Export', format: 'CSV' },
  nordpass: { place: 'Settings › Export items', format: 'CSV' },
  enpass: { place: 'File › Export', format: 'JSON' },
  kaspersky: { place: 'Settings › Import/Export › Export to text file', format: 'TXT' },
  orden: { place: 'Pass › Settings › Export', format: 'JSON' },
}

export function markOf(id: SourceId): SourceMark {
  return MARKS[id]
}

export function kindsOf(source: Source): string {
  return source.accept.map((one) => one.replace(/^\./, '')).join(', ')
}

export function stepsOf(source: Source): string {
  if (source.id === 'csv') {
    return 'Export a CSV file whose first row names its columns, such as name, url, username, password and note.'
  }
  const { place, format } = PLACES[source.id]
  return `In ${source.name}, open ${place} and export as ${format}.`
}
