import { describe, expect, test } from 'vitest'
import { droppedPaths } from './dropped-paths'

describe('the paths of files dropped on the page', () => {
  test('are asked of WebView2 with the files, then taken from the crate once they are there', async () => {
    const posted: string[] = []
    const answers = [[], ['C:\\old\\other.pdf'], ['C:\\far\\paper.pdf']]
    const waited: number[] = []
    const paper = new File(['%PDF-'], 'paper.pdf', { type: 'application/pdf' })

    const paths = await droppedPaths([paper], {
      view: {
        postMessageWithAdditionalObjects: (message, objects) =>
          posted.push(`${message} ${objects.map((one) => one.name).join()}`),
      },
      ask: () => Promise.resolve(answers.shift() ?? []),
      wait: (ms) => Promise.resolve(void waited.push(ms)),
    })

    expect(paths).toEqual(['C:\\far\\paper.pdf'])
    expect(posted).toEqual(['nib-dropped-paths paper.pdf'])
    expect(waited).toEqual([50, 50])
  })

  test('are taken from the crate alone where there is no WebView2, and given up on in time', async () => {
    let asked = 0

    const paths = await droppedPaths([new File([''], 'paper.pdf')], {
      view: undefined,
      ask: () => {
        asked++
        return Promise.resolve([])
      },
      wait: () => Promise.resolve(),
    })

    expect(paths).toEqual([])
    expect(asked).toBe(20)
  })
})
