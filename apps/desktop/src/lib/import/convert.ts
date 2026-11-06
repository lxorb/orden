import { roamText } from './roam'

const CLOSED_TAG = /(^|[\s(])#([^\s#`[\]\n]|[^\s#`[\]\n][^#`[\]\n]{0,58}[^\s#`[\]\n])#(?![\w#])/g

const ID_LINK = /\[\[(\d{12,14})((\|[^\]\n]*)?)\]\]/g

const ID_NAME = /^(\d{12,14})(?=[\s\-_]|$)/

export interface Converted {
  text: string
  changes: number
}

export function converted(text: string, names: readonly string[] = []): Converted {
  const tagged = convertTags(text)
  const linked = convertIdLinks(tagged.text, idsIn(names))
  const roamed = convertRoam(linked.text)

  return {
    text: roamed.text,
    changes: tagged.changes + linked.changes + roamed.changes,
  }
}

export function convertTags(text: string): Converted {
  let changes = 0

  const said = outsideCode(text, (words) =>
    words.replace(CLOSED_TAG, (whole, before: string, inside: string) => {
      const name = tagFrom(inside)
      if (!name) return whole

      changes += 1
      return `${before}#${name}`
    }),
  )

  return { text: said, changes }
}

const FENCE_OPENS = /^\s*(`{3,}|~{3,})/

const CODE_SPAN = /(`+)(?:[^`]|`(?!\1))*?\1(?!`)/g

export function outsideCode(text: string, change: (words: string) => string): string {
  let fence: string | null = null

  return text
    .split('\n')
    .map((line) => {
      const mark = FENCE_OPENS.exec(line)?.[1]

      if (fence !== null) {
        const closes =
          mark !== undefined &&
          mark.startsWith(fence.charAt(0)) &&
          mark.length >= fence.length &&
          line.trim() === mark
        if (closes) fence = null
        return line
      }

      if (mark !== undefined) {
        fence = mark
        return line
      }

      let out = ''
      let at = 0
      for (const span of line.matchAll(CODE_SPAN)) {
        out += change(line.slice(at, span.index)) + span[0]
        at = span.index + span[0].length
      }
      return out + change(line.slice(at))
    })
    .join('\n')
}

function tagFrom(inside: string): string {
  return inside
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}/_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\/{2,}/g, '/')
}

export function convertIdLinks(text: string, ids: ReadonlyMap<string, string>): Converted {
  if (!ids.size) return { text, changes: 0 }

  let changes = 0
  const said = text.replace(ID_LINK, (whole, id: string, shown: string) => {
    const name = ids.get(id)
    if (!name || name === id) return whole

    changes += 1
    return `[[${name}${shown}]]`
  })

  return { text: said, changes }
}

const ROAM_MARKS = /\{\{\[\[(?:TODO|DONE)\]\]\}\}|\^\^[^^\n]+\^\^|\{\{\[\[[^\]\n]+\]\]\}\}/g

const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s/

const BARE_BOX = /^(\s*)(\[[ x]\]\s)/

export function convertRoam(text: string): Converted {
  let fenced = false
  let changes = 0

  const lines = text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return line
    }

    if (fenced) return line

    const marks = line.match(ROAM_MARKS)?.length ?? 0
    if (!marks) return line

    changes += marks
    const said = roamText(line)
    if (LIST_MARKER.test(line)) return said

    const bare = BARE_BOX.exec(said)
    return bare ? `${bare[1]}- ${said.slice((bare[1] ?? '').length)}` : said
  })

  return { text: lines.join('\n'), changes }
}

export function idsIn(names: readonly string[]): Map<string, string> {
  const ids = new Map<string, string>()

  for (const name of names) {
    const stem = name.replace(/\.(md|markdown)$/i, '')
    const id = ID_NAME.exec(stem)?.[1]
    if (!id || stem === id) continue
    if (!ids.has(id)) ids.set(id, stem)
  }

  return ids
}
