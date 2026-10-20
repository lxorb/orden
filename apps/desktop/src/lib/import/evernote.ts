/** An Evernote `.enex` export.
 *
 *  One file per notebook, holding a `<note>` per note: a title, the body as ENML
 *  (which is XHTML with three tags of Evernote's own), the dates, the tags, and
 *  every attachment as base64 right there in the file. So an `.enex` is the one
 *  export that needs no folder and no second file, and the one that can be half a
 *  gigabyte.
 *
 *  The three tags of its own are why this is not simply the HTML converter:
 *
 *  `<en-media hash="...">` is how a note points at its own picture, by the MD5 of
 *  the attachment's bytes. It becomes an ordinary picture or a link to the file,
 *  which is what makes an imported note show the photograph that was in it.
 *
 *  `<en-todo>` is a checkbox, which becomes a task list, because that is what it
 *  was for.
 *
 *  `<en-crypt>` is text encrypted with a passphrase nib does not have and never
 *  will. Those are counted and said out loud rather than quietly dropped. */

import { fromBase64 } from '../bytes'
import { key } from '../i18n.svelte'
import { htmlToMarkdown } from '@nib/markdown/from-html'

import { dayOf, noteText, type Meta } from './meta'
import { md5 } from './md5'
import { Names, safeName, titleFrom } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'
import { closingOf, element, elements, plainText, textOf, textsOf } from './xml'

/** Where an attachment goes: one folder for the lot, beside the notes, which is
 *  the same arrangement the app's own Attachments setting means by `assets`. */
const ASSETS = 'assets'

/** The extensions worth naming, for a file whose own name the export lost. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'text/plain': 'txt',
}

/** An attachment as a note's body points at it. */
interface Attachment {
  path: string
  mime: string
}

export async function readEvernote(sources: readonly Source[]): Promise<ImportPlan> {
  const files = sources.filter((one) => /\.enex$/i.test(one.path))
  const names = new Names()
  const written: Planned[] = []
  const lost: Lost[] = []
  let encrypted = 0
  let reminders = 0
  let missing = 0

  // One file per set of bytes, whichever notes carry it: a picture pasted into
  // two notes, or a note duplicated, is one file both point at rather than a copy
  // apiece stepped `photo 2.png`.
  const stored = new Map<string, string>()

  // A notebook each when there are several, because that is what the files are;
  // one file is the import itself and needs no folder of its own.
  const perNotebook = files.length > 1

  for (const source of files) {
    const xml = await source.text()
    const notebook = perNotebook
      ? safeName((source.path.split('/').pop() ?? '').replace(/\.enex$/i, ''))
      : ''

    for (const note of elements(xml, 'note')) {
      const content = textOf(note.inner, 'content') ?? ''
      const attachments = new Map<string, Attachment>()
      let unreadable = 0

      for (const resource of elements(note.inner, 'resource')) {
        const bytes = bytesOf(element(resource.inner, 'data')?.inner ?? '')
        if (!bytes?.length) {
          unreadable += 1
          continue
        }

        const mime = (textOf(resource.inner, 'mime') ?? '').trim().toLowerCase()
        const hash = md5(bytes)
        let path = stored.get(hash)
        if (!path) {
          const said = textOf(resource.inner, 'file-name')
          path = names.free(`${ASSETS}/${fileName(said, mime, hash)}`)
          stored.set(hash, path)
          written.push({ kind: 'file', path, bytes })
        }

        attachments.set(hash, { path, mime })
      }

      const enml = withoutEvernote(content, attachments, !!notebook)
      encrypted += enml.encrypted

      // An attachment that is not there is said out loud rather than skipped: a
      // picture that vanishes without a word is the one loss nobody goes looking
      // for. An unreadable attachment and the place in the note that pointed at
      // it are the same loss, and the bytes that would say which place is which
      // are the ones that could not be read, so a note counts the larger.
      missing += Math.max(unreadable, enml.missing)

      // The attributes rather than the whole note, because an attachment has a
      // `source-url` of its own: the address a clipped picture came from is not
      // the page the note was clipped from.
      const attributes = element(note.inner, 'note-attributes')?.inner ?? ''
      if (hadReminder(attributes)) reminders += 1

      // The title after the words, because a note with no title of its own is
      // named after what it says, and what it says is the markdown rather than
      // the markup it arrived as.
      // The addresses in an export are the export's own to resolve; see
      // `fileTargets` and rewrite.ts.
      const words = htmlToMarkdown(enml.html, { fileTargets: true, appTargets: true })
      const said = textOf(note.inner, 'title')?.trim()
      const title = (said ? safeName(said) : titleFrom(words)) ?? 'Untitled'
      const path = names.free(`${notebook ? `${notebook}/` : ''}${title}.md`)

      const meta: Meta = { tags: textsOf(note.inner, 'tag') }
      const made = dayOf(textOf(note.inner, 'created')?.trim())
      const changed = dayOf(textOf(note.inner, 'updated')?.trim())
      if (made) meta.date = made
      if (changed) meta.updated = changed

      const extra: [string, string][] = []
      const origin = textOf(attributes, 'source-url')?.trim()
      if (origin) extra.push(['source', origin])
      const author = textOf(attributes, 'author')?.trim()
      if (author) extra.push(['author', author])
      if (extra.length) meta.extra = extra

      written.push({ kind: 'note', path, text: noteText(title, words, meta) })
    }
  }

  if (encrypted) {
    lost.push({
      text: key('{count} passages are encrypted, and nothing can read them without Evernote'),
      values: { count: encrypted },
    })
  }

  if (reminders) {
    lost.push({
      text: key('{count} notes had a reminder, which the export does not carry'),
      values: { count: reminders },
    })
  }

  if (missing) {
    lost.push({
      text: key('{count} attachments were missing from the export or could not be read'),
      one: '{count} attachment was missing from the export or could not be read',
      values: { count: missing },
    })
  }

  return { format: 'evernote', files: written, lost }
}

/** An attachment's bytes, or null where the base64 is not base64: one damaged
 *  attachment is that attachment lost, not the whole export refused. */
function bytesOf(inner: string): Uint8Array | null {
  try {
    return fromBase64(plainText(inner))
  } catch {
    return null
  }
}

/** Whether a note had a reminder. Every note Evernote exports says
 *  `<reminder-order>0</reminder-order>`, and a zero is the absence of one: a
 *  reminder is a time, or a place in the reminder list that is not nought. */
function hadReminder(attributes: string): boolean {
  if (textOf(attributes, 'reminder-time')?.trim()) return true
  const order = textOf(attributes, 'reminder-order')?.trim() ?? ''
  return order !== '' && !/^0+$/.test(order)
}

/** What to call an attachment: its own name where the export kept one, and its
 *  hash where it did not, which is what the app already names a pasted picture.
 *  Only the name: an older Windows client kept the whole path the file was
 *  attached from, `C:\Users\…\scan.pdf`, and the folders in it are somebody's
 *  disk rather than part of the name. Only a path that starts at the top of a
 *  disk is taken for one, so a name with a slash in it is still its name. */
function fileName(said: string | null, mime: string, hash: string): string {
  const whole = said?.trim() ?? ''
  const own = /^(?:[A-Za-z]:)?[\\/]/.test(whole) ? (whole.split(/[\\/]/).pop() ?? '') : whole
  const named = own ? safeName(own) : ''
  if (named && /\.[A-Za-z0-9]{1,5}$/.test(named)) return named

  const extension = EXTENSIONS[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/g, '') ?? 'bin'
  return named ? `${named}.${extension}` : `${hash.slice(0, 16)}.${extension}`
}

/** The elements that have no inside in HTML, and so may close themselves there. */
const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i

/** Whether a tag's attributes say it is checked, quoted either way or not at all. */
const CHECKED = /checked\s*=\s*["']?true/i

/** A checkbox where a list item starts, which is where the converter reads one. */
function box(checked: boolean): string {
  return `<input type="checkbox"${checked ? ' checked' : ''}>`
}

/** Evernote's own three tags turned into markup the converter knows, and the
 *  count of what had to be left as it was. */
function withoutEvernote(
  enml: string,
  attachments: ReadonlyMap<string, Attachment>,
  inFolder: boolean,
): { html: string; encrypted: number; missing: number } {
  let encrypted = 0
  let missing = 0

  // ENML is XML, where `<div/>` is an empty div. Read as HTML it is a div that
  // opens and never closes, so every one after it nests inside the one before:
  // a clipped page with thousands of them came out as one paragraph thousands of
  // levels deep, and a deep enough one did not come out at all. Evernote's own
  // three are left for the rules below, which know both spellings.
  let html = enml.replace(
    /<([A-Za-z][\w:.-]*)(\s[^<>]*?)?\s*\/>/g,
    (whole, name: string, said: string | undefined) =>
      VOID.test(name) || /^en-/i.test(name) ? whole : `<${name}${said ?? ''}></${name}>`,
  )

  html = codeBlocks(html)
  html = nestedLists(html)

  // Evernote writes every list item's words in a div of their own, which the
  // converter reads as a paragraph: a list a blank line between each item, spaced
  // like prose. A break at the end of the line is the editor's own and goes too.
  html = html.replace(
    /<li(\s[^>]*)?>\s*<div\b[^>]*>((?:(?!<\/?div\b)[\s\S])*?)<\/div>/gi,
    (_whole, said: string | undefined, words: string) =>
      `<li${said ?? ''}>${words.replace(/(?:\s*<br\s*\/?>)+\s*$/i, '')}`,
  )

  // The checklist the current Evernote writes: a list marked `--en-todo` whose
  // items say `--en-checked`, with no `<en-todo>` anywhere in it.
  html = html.replace(
    /<li\b([^>]*?--en-checked:\s*(true|false)[^>]*)>/gi,
    (_whole, said: string, checked: string) =>
      `<li${said}>${box(checked.toLowerCase() === 'true')}`,
  )

  // A checkbox at the start of a list item, bold or italic or not, is that item's
  // box: written out as `[x]` in the item's words it was text with brackets.
  html = html.replace(
    /<li(\s[^>]*)?>((?:\s*<(?:b|i|u|em|strong|span|font)\b[^>]*>)*)\s*<en-todo([^>]*?)\/?>(?:\s*<\/en-todo>)?/gi,
    (_whole, said: string | undefined, wrapped: string, todo: string) =>
      `<li${said ?? ''}>${box(CHECKED.test(todo))}${wrapped}`,
  )

  // A checkbox line is a task list item, which is what it was drawn as. Evernote
  // draws a checklist as one such line under another, so lines that follow each
  // other are one list: a list apiece came out a blank line apart, a checklist
  // spaced like paragraphs.
  html = html
    .replace(
      /<div[^>]*>\s*<en-todo([^>]*?)\/?>(?:\s*<\/en-todo>)?\s*([\s\S]*?)<\/div>/gi,
      (_whole, said: string, rest: string) =>
        `<ul data-todo><li>${box(CHECKED.test(said))}${rest.replace(/(?:\s*<br\s*\/?>)+\s*$/i, '')}</li></ul>`,
    )
    .replace(/<\/ul>\s*<ul data-todo>/gi, '')

  // One outside a div still says what it was.
  html = html.replace(/<en-todo([^>]*?)\/?>(?:\s*<\/en-todo>)?/gi, (_whole, said: string) =>
    CHECKED.test(said) ? '[x] ' : '[ ] ',
  )

  // One character rather than a word: nothing can read the passage, a word in
  // one language written into somebody's note is worse than a mark that says
  // "something was here", and an ellipsis is that mark in every language. The
  // count is what the sheet says out loud before any of it is written. Not a
  // paragraph of its own: a passage encrypted in the middle of a sentence leaves
  // the sentence whole around the mark.
  html = html.replace(/<en-crypt[^>]*\/>|<en-crypt[\s\S]*?<\/en-crypt>/gi, () => {
    encrypted += 1
    return '…'
  })

  // A note in a notebook's folder is one level below the attachments.
  const folder = inFolder ? '../' : ''
  const shown = new Set<string>()

  const pointAt = (attachment: Attachment, type: string): string => {
    const address = `${folder}${attachment.path}`.replace(/ /g, '%20')
    const name = attachment.path.split('/').pop() ?? attachment.path

    // A picture is shown and everything else is a link to the file, which is
    // what a paper or a spreadsheet in a note should be.
    return type.startsWith('image/')
      ? `<img src="${address}" alt="">`
      : `<a href="${address}">${name}</a>`
  }

  html = html.replace(/<en-media([^>]*)\/?>(?:<\/en-media>)?/gi, (_whole, said: string) => {
    const hash = /\bhash\s*=\s*["']?([0-9a-f]+)/i.exec(said)?.[1]?.toLowerCase() ?? ''
    const attachment = attachments.get(hash)
    if (!attachment) {
      missing += 1
      return ''
    }

    shown.add(hash)
    const type = /\btype\s*=\s*["']([^"']+)/i.exec(said)?.[1]?.toLowerCase() ?? attachment.mime
    return pointAt(attachment, type)
  })

  // An attachment the note carried and its body never placed is still the note's:
  // at the end of it, rather than a file in the folder nothing points at.
  const loose = [...attachments].filter(([hash]) => !shown.has(hash))
  for (const [, attachment] of loose) {
    html += `<div>${pointAt(attachment, attachment.mime)}</div>`
  }

  return { html, encrypted, missing }
}

/** Evernote's code block, which is a div that says `--en-codeblock` in its style
 *  with a div per line inside it, as code: as divs it was a paragraph per line,
 *  with the code's own asterisks and underscores read as emphasis. */
function codeBlocks(html: string): string {
  const opens = /<div\b[^>]*-en-codeblock:\s*true[^>]*>/gi
  let out = ''
  let at = 0

  for (let found = opens.exec(html); found; found = opens.exec(html)) {
    if (found.index < at) continue

    const from = found.index + found[0].length
    const end = closingOf(html, 'div', from)
    // A line is a div, and an empty line a div with only a break in it. The
    // empty one is held as a mark until the end of the lines is read, so the
    // spacing between the divs, which is not the code's, can go.
    const lines = html
      .slice(from, end)
      .replace(/<div\b[^>]*>\s*<br\s*\/?>\s*<\/div>/gi, '\uE000')
      .replace(/<br\s*\/?>\s*(?=<\/div>)/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/(?:<\/div>\s*)+/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\uE000/g, '\n')
      // Evernote keeps a code line's indent as no-break spaces, which code read
      // by anything else is not indented with.
      .replace(/&nbsp;|&#160;|\u00A0/gi, ' ')
      .replace(/^\n+|\n+$/g, '')

    out += `${html.slice(at, found.index)}<pre><code>${lines}</code></pre>`
    at = html.startsWith('</div', end) ? html.indexOf('>', end) + 1 || html.length : end
    opens.lastIndex = at
  }

  return out + html.slice(at)
}

/** A list inside a list as Evernote writes it: beside the item it belongs to,
 *  `<li>one</li><ul>…</ul>`, rather than inside it. HTML reads that as a list
 *  with a stray list in it, which came out as every item at the same level a
 *  blank line apart and an ordered list numbered past the gap. Each such list is
 *  moved into the item before it, which is where it is drawn. */
function nestedLists(html: string): string {
  const tags = /<(\/?)(ul|ol|li)\b[^>]*>/gi
  const list = /\s*<(?:ul|ol)\b/iy
  const listFollows = (at: number) => {
    list.lastIndex = at
    return list.test(html)
  }

  let out = ''
  let at = 0
  let depth = 0
  // The depths at which an item's close is held back until its lists are in.
  const held: number[] = []

  for (const found of html.matchAll(tags)) {
    const [whole, closing, name] = found
    out += html.slice(at, found.index)
    at = found.index + whole.length

    if (name?.toLowerCase() === 'li') {
      if (closing && listFollows(at)) held.push(depth)
      else out += whole
      continue
    }

    if (!closing) {
      depth += 1
      out += whole
      continue
    }

    depth -= 1
    out += whole
    // An item whose list closed around it before its own lists did, which only a
    // damaged note does: nothing is owed to it any more.
    while ((held.at(-1) ?? -1) > depth) held.pop()
    if (held.at(-1) === depth && !listFollows(at)) {
      held.pop()
      out += '</li>'
    }
  }

  return out + html.slice(at)
}
