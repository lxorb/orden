// @vitest-environment jsdom
import { renderMarkdown } from '@orden/markdown'
import { exportCss, themeCss } from '@orden/themes/raw'
import JSZip from 'jszip'
import { expect, test } from 'vitest'
import { toEpub } from './epub'

const NOTE = `# Trip

Packing: ==🔴 passport== and ==🟢 tickets==.

| Day | Place |
| - | - |
| 1 | Rome |
`
async function chapter(): Promise<{ css: string; page: Document }> {
  const bytes = await toEpub({
    title: 'Trip',
    author: 'Me',
    lang: 'en',
    identifier: 'urn:orden:trip',
    modified: '2026-11-17T00:00:00Z',
    body: renderMarkdown(NOTE),
    css: [themeCss, exportCss].join('\n'),
    pictures: [],
  })
  const zip = await JSZip.loadAsync(bytes)
  const css = (await zip.file('OEBPS/styles/document.css')?.async('string')) ?? ''
  const xhtml = (await zip.file('OEBPS/text/section-1.xhtml')?.async('string')) ?? ''
  return { css, page: new DOMParser().parseFromString(xhtml, 'application/xhtml+xml') }
}
test('the book keeps the colour of a red highlight', async () => {
  const { css, page } = await chapter()
  expect(css).toContain('#write mark.tone-1')
  expect(page.querySelector('mark.tone-1')).not.toBeNull()
  expect(page.querySelector('#write mark.tone-1')).not.toBeNull()
})
test('the book keeps the borders of a table', async () => {
  const { css, page } = await chapter()
  expect(css).toContain('#write td')
  expect(page.querySelector('td')).not.toBeNull()
  expect(page.querySelector('#write td')).not.toBeNull()
})
