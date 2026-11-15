const FILES =
  'md|markdown|txt|canvas|pages|base|pdf|url|png|jpe?g|gif|webp|svg|mp3|m4a|wav|webm|mp4|mov|csv|json|html?|epub|docx?|xlsx?|pptx?|zip|excalidraw'

const NOT_INSIDE = String.raw`(?<![\w/\\:.~<-])`

const ROUTE = String.raw`(?!/(?:v\d+|api)/)`

const ROOT = String.raw`(?:file:/{2,3}|[A-Za-z]:[\\/]|\\\\|~[\\/]|${ROUTE}/)`

const ENDS = String.raw`(?:-|\d+\b|not\b|is\b|was\b|were\b|could\b|has\b|had\b|are\b|and\b|to\b|from\b|into\b|for\b|failed\b|cannot\b|can't\b|does\b|did\b|already\b|because\b|of\b|in\b|on\b|at\b|with\b|after\b|before\b|but\b|so\b|as\b|took\b|unreadable\b)`

const WHOLE = new RegExp(
  String.raw`${NOT_INSIDE}${ROOT}(?:(?! - )[^\n"'\x60<>|])*?\.(${FILES})\b(?![\w-])`,
  'gi',
)

const MORE = String.raw`(?: (?!${ENDS})[^\s"'\x60<>|:;,()]+)*`

const OPEN = new RegExp(String.raw`${NOT_INSIDE}${ROOT}[^\s"'\x60<>|:;,()]+${MORE}`, 'g')

const NAMED = new RegExp(
  String.raw`(?:(?<=(?:^|\s)(?:INFO|WARN|ERROR|info|warn|error) +)|(?<=: )|(?<=[(\[])|(?<= (?:of|to|from|into|at|in|for|as) ))(?=\S)[^\n"'\x60<>|:()\[\]]*?\.(${FILES})\b(?![\w-])`,
  'gim',
)

const SAYING =
  /^(?:(?:could|can't|cannot|not|failed|unable|to|parse|read|write|open|load|save|move|moved|delete|the|rename|of|a|file|note|from|in|into|at|for|as|sync|skipping)\s+)+/

const FOLDER = new RegExp(
  String.raw`${NOT_INSIDE}(?!(?:text|image|audio|video|application)/)[^\s"'\x60<>|:;,()]*[\\/][^\s"'\x60<>|:;,()]+${MORE}`,
  'g',
)

const NO_FOLDER = /^(?:and\/or|read\/write|input\/output|w\/o|[\d/.-]+|\/(?:v\d+|api)\/\S*)$/i

const THE_APPS = /\.(?:ts|js|mjs|svelte|rs|tsx|jsx)$/i

const ASSET = /\b(?:asset:\/\/\S+|https?:\/\/asset\.localhost\/\S+)/gi

const ADDRESS = /\b(https?|wss?|ftp):\/\/(?:[^\s/@]+@)?([^\s/?#]+)([^\s?#]*)(?:[?#][^\s]*)?/gi

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

const QUOTED = /"[^"\n]+"|(?<![\w])'[^'\n]+'(?![\w])|\x60[^\x60\n]+\x60/g

const UNFILED = /\b(save|across): (?!<path)(.+?)(?= - | took the whole words)/g

export function scrubbedLog(log: string): string {
  const seen = new Map<string, number>()
  const path = (whole: string, kind?: string) => {
    const number = seen.get(whole) ?? seen.size + 1
    seen.set(whole, number)
    return kind ? `<path ${number}>.${kind}` : `<path ${number}>`
  }
  const kept = (whole: string) => (THE_APPS.test(whole) ? whole : path(whole))

  return log
    .replace(ASSET, (whole: string) => path(whole))
    .replace(ADDRESS, (whole: string, scheme: string, host: string, route: string) => {
      if (THE_APPS.test(route.replace(/\)+$/, '').replace(/(?::\d+)+$/, ''))) return whole
      const own = /^\/v\d+\//.test(route)
      return `${scheme}://${host}${own ? route : route.length > 1 ? '/…' : ''}`
    })
    .replace(EMAIL, '<email>')
    .replace(QUOTED, '<quoted>')
    .replace(WHOLE, (whole: string, kind: string) => path(whole, kind))
    .replace(OPEN, kept)
    .replace(NAMED, (whole: string, kind: string) => {
      const said = SAYING.exec(whole)?.[0] ?? ''
      return said + path(whole.slice(said.length).trim(), kind)
    })
    .replace(FOLDER, (whole: string) => (NO_FOLDER.test(whole) ? whole : kept(whole)))
    .replace(UNFILED, (_: string, what: string) => `${what}: <a draft>`)
}
