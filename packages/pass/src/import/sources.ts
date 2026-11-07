export const SOURCE_IDS = [
  'proton',
  'bitwarden',
  'onepassword',
  'lastpass',
  'chrome',
  'edge',
  'brave',
  'firefox',
  'safari',
  'keepass',
  'keepassxc',
  'dashlane',
  'keeper',
  'roboform',
  'nordpass',
  'enpass',
  'kaspersky',
  'orden',
  'csv',
] as const

export type SourceId = (typeof SOURCE_IDS)[number]

export interface Source {
  id: SourceId
  name: string
  accept: readonly string[]
}

export const SOURCES: readonly Source[] = [
  { id: 'proton', name: 'Proton Pass', accept: ['.zip', '.json', '.csv'] },
  { id: 'bitwarden', name: 'Bitwarden', accept: ['.json', '.csv'] },
  { id: 'onepassword', name: '1Password', accept: ['.1pux', '.1pif', '.csv'] },
  { id: 'lastpass', name: 'LastPass', accept: ['.csv'] },
  { id: 'chrome', name: 'Chrome', accept: ['.csv'] },
  { id: 'edge', name: 'Edge', accept: ['.csv'] },
  { id: 'brave', name: 'Brave', accept: ['.csv'] },
  { id: 'firefox', name: 'Firefox', accept: ['.csv'] },
  { id: 'safari', name: 'Safari and Apple Passwords', accept: ['.csv'] },
  { id: 'keepass', name: 'KeePass', accept: ['.xml'] },
  { id: 'keepassxc', name: 'KeePassXC', accept: ['.csv'] },
  { id: 'dashlane', name: 'Dashlane', accept: ['.csv', '.zip'] },
  { id: 'keeper', name: 'Keeper', accept: ['.json', '.csv'] },
  { id: 'roboform', name: 'RoboForm', accept: ['.csv'] },
  { id: 'nordpass', name: 'NordPass', accept: ['.csv'] },
  { id: 'enpass', name: 'Enpass', accept: ['.json'] },
  { id: 'kaspersky', name: 'Kaspersky Password Manager', accept: ['.txt'] },
  { id: 'orden', name: 'Orden Pass', accept: ['.json'] },
  { id: 'csv', name: 'Another app (CSV)', accept: ['.csv'] },
]

export function sourceOf(id: SourceId): Source {
  const found = SOURCES.find((one) => one.id === id)
  if (!found) throw new Error(`pass: no import source ${id}`)
  return found
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

const ZIPPED: Partial<Record<SourceId, readonly string[]>> = {
  proton: ['.zip'],
  onepassword: ['.1pux'],
  dashlane: ['.zip'],
}

export function needsZip(source: SourceId, fileName: string): boolean {
  return ZIPPED[source]?.includes(extensionOf(fileName)) ?? false
}
