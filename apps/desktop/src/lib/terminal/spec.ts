import { folderOf, withinSpace } from '../space-paths'
import { isRecord, isString } from '../stored'

export interface Spec {
  shell: string
  folder: string | null
  key: string
  name: string | null
  icon?: string
  iconColor?: string
  via?: string
}

const SSH = 'ssh:'

export function hostShell(id: string): string {
  return `${SSH}${id}`
}

export function hostIdOf(shell: string): string | null {
  return shell.startsWith(SSH) && shell.length > SSH.length ? shell.slice(SSH.length) : null
}

export function readSpec(text: string): Spec | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || !isString(value.shell) || !value.shell) return null

  return {
    shell: value.shell,
    folder: isString(value.folder) && value.folder ? value.folder : null,
    key: isString(value.key) && value.key ? value.key : '',
    name: isString(value.name) && value.name.trim() ? value.name : null,
    ...(isString(value.icon) && value.icon ? { icon: value.icon } : {}),
    ...(isString(value.icon) && value.icon && isString(value.iconColor) && value.iconColor
      ? { iconColor: value.iconColor }
      : {}),
    ...(isString(value.via) && value.via && hostIdOf(value.shell) !== null
      ? { via: value.via }
      : {}),
  }
}

export function writeSpec(spec: Spec): string {
  const { shell, folder, key, name, icon, iconColor, via } = spec
  return JSON.stringify({
    shell,
    folder,
    key,
    ...(name ? { name } : {}),
    ...(icon ? { icon } : {}),
    ...(icon && iconColor ? { iconColor } : {}),
    ...(via && hostIdOf(shell) !== null ? { via } : {}),
  })
}

export function startingFolder(
  showing: string | null,
  space: string | null,
  roots: readonly string[],
): string | null {
  if (showing !== null && !roots.some((root) => withinSpace(root, showing) !== null)) {
    const folder = folderOf(showing)
    if (folder) return folder
  }

  return space
}

export function reportedFolder(
  code: 7 | 9,
  data: string,
  windows: boolean,
  wsl: boolean,
): string | null {
  if (code === 9) {
    if (!data.startsWith('9;')) return null
    const path = data.slice(2).replace(/^"(.*)"$/, '$1')
    return path ? path : null
  }

  const match = /^file:\/\/[^/]*(\/.*)$/.exec(data)
  if (!match?.[1]) return null

  let path: string
  try {
    path = decodeURIComponent(match[1])
  } catch {
    path = match[1]
  }

  if (!windows || wsl) return path

  const drive = /^\/([A-Za-z])(?::?)(\/.*)?$/.exec(path)
  if (!drive?.[1]) return null
  return `${drive[1].toUpperCase()}:${(drive[2] ?? '/').replace(/\//g, '\\')}`
}
