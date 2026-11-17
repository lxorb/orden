import { renderMarkdown } from '@orden/markdown'

const IMAGE = /<img\b[^>]*>/gi
const DATA_IMAGE = /^data:image\//i

function attributeOf(tag: string, name: string): string {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? ''
}

function linkInsteadOf(tag: string): string {
  const src = attributeOf(tag, 'src')
  if (DATA_IMAGE.test(src)) return tag
  const alt = attributeOf(tag, 'alt')
  return `<a href="${src}" rel="noopener noreferrer nofollow">${alt || src}</a>`
}

export function noteHtml(note: string): string {
  return renderMarkdown(note, { escapeHtml: true, footnotes: true }).replace(IMAGE, linkInsteadOf)
}
