import type { Words } from '../reading/find'

export function runsOfItems(items: readonly object[]): string[] {
  return items.flatMap((item) => {
    if (!('str' in item) || typeof item.str !== 'string') return []
    const ends = 'hasEOL' in item && item.hasEOL === true && !/\s$/.test(item.str)
    return [ends ? `${item.str} ` : item.str]
  })
}

export function textOfRuns(runs: readonly string[]): string {
  return runs.join('')
}

export function wordsOfRuns(runs: readonly string[], divs: readonly HTMLElement[]): Words {
  const words: Words = { text: textOfRuns(runs), pieces: [] }
  let at = 0

  for (const [index, run] of runs.entries()) {
    const node = divs[index]?.firstChild
    if (run && isText(node)) words.pieces.push({ node, at })
    at += run.length
  }

  return words
}

function isText(node: ChildNode | null | undefined): node is Text {
  return node?.nodeType === 3
}
