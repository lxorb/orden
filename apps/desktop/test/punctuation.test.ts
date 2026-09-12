import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

// `.claude` holds tooling state rather than anybody's words: the settings, and
// whole copies of this repository checked out for an agent to work in, which
// would otherwise be read as second copies of every file here.
const SKIP = '.claude/'
const EXTENSIONS = ['.ts', '.svelte', '.rs', '.css', '.json', '.jsonc', '.md', '.mjs', '.yml']

/** Smart punctuation turns what someone types into an em dash. That is their
 *  document, not the app's own words, so it is the one place they belong. */
const ALLOWED = ['packages/editor/src/typography.ts', 'packages/editor/src/typography.test.ts']

/** Built from its code point so this file is not its own first offender. */
const EM_DASH = String.fromCharCode(0x2014)

/** The files this repository is made of, as paths from its root: what git tracks,
 *  plus what has been written and not added yet, minus everything .gitignore names.
 *
 *  Asked of git rather than walked from the root, because a walk reads whatever
 *  else happens to be in the tree at that second - a build another drive is
 *  halfway through, the bundle a local Worker left behind, the pictures an
 *  end-to-end run took - and one minified stylesheet in somebody else's build
 *  output is enough to fail this for an em dash nobody here wrote. What belongs to
 *  this repository is a question git already answers: `-c` is what it tracks, `-o`
 *  what is new, `--exclude-standard` what .gitignore says to leave out, and `-z`
 *  keeps a path with a space in it in one piece. */
function sources(): string[] {
  const listed = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

  return (
    listed
      .split('\0')
      .filter((path) => path && !path.startsWith(SKIP))
      .filter((path) => EXTENSIONS.some((extension) => path.endsWith(extension)))
      // A file git tracks that somebody has deleted without saying so yet is still
      // listed, and is no longer anybody's words.
      .filter((path) => existsSync(join(ROOT, path)))
  )
}

describe('the app writes without em dashes', () => {
  test('nothing outside smart punctuation uses one', () => {
    const offenders: string[] = []

    for (const relative of sources()) {
      if (ALLOWED.includes(relative)) continue

      const text = readFileSync(join(ROOT, relative), 'utf8')
      if (text.includes(EM_DASH)) {
        const line = text.split('\n').findIndex((one: string) => one.includes(EM_DASH)) + 1
        offenders.push(`${relative}:${line}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
