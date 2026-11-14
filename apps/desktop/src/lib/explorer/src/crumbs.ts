export interface Crumb {
  name: string
  path: string
}

function parts(path: string): { top: string; steps: string[]; separator: string } | null {
  const unc = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)(.*)$/.exec(path)
  if (unc) {
    const [, server = '', share = '', rest = ''] = unc
    return { top: `\\\\${server}\\${share}\\`, steps: split(rest), separator: '\\' }
  }
  const drive = /^([A-Za-z]:)(?:[\\/](.*))?$/.exec(path)
  if (drive) {
    const [, letter = '', rest = ''] = drive
    return { top: `${letter.toUpperCase()}\\`, steps: split(rest), separator: '\\' }
  }
  if (path.startsWith('/')) return { top: '/', steps: split(path), separator: '/' }
  return null
}

function split(rest: string): string[] {
  return rest.split(/[\\/]+/).filter(Boolean)
}

export function crumbsOf(folder: string): Crumb[] {
  const said = parts(folder)
  if (!said) return [{ name: folder, path: folder }]
  const out: Crumb[] = [{ name: topName(said.top), path: said.top }]
  let path = said.top
  for (const step of said.steps) {
    path = path.endsWith(said.separator) ? `${path}${step}` : `${path}${said.separator}${step}`
    out.push({ name: step, path })
  }
  return out
}

function topName(top: string): string {
  return top === '/' ? '/' : top.replace(/\\$/, '')
}

export function folderName(folder: string): string {
  return crumbsOf(folder).at(-1)?.name ?? folder
}

export function parentOf(folder: string): string | null {
  const crumbs = crumbsOf(folder)
  return crumbs.length > 1 ? (crumbs.at(-2)?.path ?? null) : null
}

export function typedFolder(typed: string, here: string, home: string | null): string | null {
  const said = typed.trim()
  if (!said) return null
  let whole = said
  if (home && (said === '~' || /^~[\\/]/.test(said))) whole = `${home}${said.slice(1)}`
  else if (!parts(said)) whole = `${here}/${said}`
  const at = parts(whole)
  if (!at) return null
  const steps: string[] = []
  for (const step of at.steps) {
    if (step === '.') continue
    if (step === '..') steps.pop()
    else steps.push(step)
  }
  return steps.reduce(
    (path, step) =>
      path.endsWith(at.separator) ? `${path}${step}` : `${path}${at.separator}${step}`,
    at.top,
  )
}
