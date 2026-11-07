import type { Formatting } from './api'

const HOLD = '\u0000'

function escaped(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function plainHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const linked = escaped(block).replace(
        /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g,
        (url) => `<a href="${url}">${url}</a>`,
      )
      return `<p>${linked.replace(/\n/g, '<br>')}</p>`
    })
    .join('')
}

export function shownText(text: string, formatting: Formatting): string {
  if (formatting !== 'mrkdwn') return text
  return text
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, '[$2]($1)')
    .replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, `$1${HOLD}$2${HOLD}`)
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1*$2*')
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/g, '$1~~$2~~')
    .replace(new RegExp(`${HOLD}([^${HOLD}]+)${HOLD}`, 'g'), '**$1**')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function sentText(text: string, formatting: Formatting): string {
  switch (formatting) {
    case 'markdown':
      return text
    case 'plain':
      return text
        .replace(/\*\*([^*\n]+)\*\*/g, '$1')
        .replace(/~~([^~\n]+)~~/g, '$1')
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    case 'mrkdwn':
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*([^*\n]+)\*\*/g, `${HOLD}$1${HOLD}`)
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1_$2_')
        .replace(new RegExp(`${HOLD}([^${HOLD}]+)${HOLD}`, 'g'), '*$1*')
        .replace(/~~([^~\n]+)~~/g, '~$1~')
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<$2|$1>')
    case 'html':
      return escaped(text)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')
        .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
  }
}

export function subjectOf(subject: string): string {
  return subject.replace(/^(?:\s*(?:re|aw|fwd?|wg|sv|tr)\s*:\s*)+/i, '').trim()
}
