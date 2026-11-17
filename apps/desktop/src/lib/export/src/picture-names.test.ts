import { describe, expect, test, vi } from 'vitest'

vi.mock('../../workspace/src/api', () => ({
  workspace: { wordsNow: () => undefined, active: null, protection: { locked: () => false } },
}))
vi.mock('../../sharing/src/api', () => ({ trustsHtmlIn: () => true }))
vi.mock('../../theme/src/theme.svelte', () => ({
  theme: { accent: 'violet', active: { path: null } },
}))
vi.mock('../../modes/src/api', () => ({
  modes: { codeTheme: 'auto' },
  choices: { page: undefined, exportAppearance: 'light' },
}))
vi.mock('../../link-index/src/api', () => ({
  links: {
    relativeTarget: () => null,
    spaceRead: () => Promise.resolve(),
    embedNote: () => Promise.resolve(null),
    fileFor: (name: string) =>
      name === 'Pasted image 2024.png' ? '/space/attachments/Pasted image 2024.png' : null,
  },
  notePicture: (src: string) => src,
}))
vi.mock('../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../platform/src/tauri')>()),
  invoke: () => Promise.resolve(''),
  isNative: false,
}))

const { renderOptions } = await import('./context')

describe('a picture embedded by its bare name and kept in the attachments folder', () => {
  test('is read from where the reading view finds it, so the export carries it', async () => {
    const options = await renderOptions({
      source: '![[Pasted image 2024.png]]\n',
      name: 'Today.md',
      path: '/space/Notes/Today.md',
      trusted: true,
    })

    expect(options.resolveImage?.('Pasted%20image%202024.png')).toBe(
      '/space/attachments/Pasted image 2024.png',
    )
  })

  test('inside a note embedded from another folder is read from the folder of that note', async () => {
    const options = await renderOptions({
      source: '![[Plan]]\n',
      name: 'Today.md',
      path: '/space/Today.md',
      trusted: true,
    })
    const html = options.pictures?.('<p><img src="../assets/shot.png" alt=""></p>', {
      text: '![](../assets/shot.png)\n',
      escapeHtml: false,
      path: '/space/Projects/Plan.md',
    })
    const src = /src="([^"]*)"/.exec(html ?? '')?.[1] ?? ''
    expect(options.resolveImage?.(src)).toBe('/space/assets/shot.png')
  })
})
