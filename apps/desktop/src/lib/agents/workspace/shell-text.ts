/** A command line and what a terminal printed, as words. Pure; see terminal.ts. */

/** The program a command line starts, as a list of allowed programs names it: the first
 *  word in lower case, and only where it is a bare name the shell looks up on its path.
 *  A word with a folder, an ending or a quote is whatever file that names - `./git`,
 *  `/tmp/x/git.sh`, `"git"/../../bin/sh` - and no program on any list: the empty name. */
export function programOf(command: string): string {
  const word = /^\s*(\S+)/.exec(command)?.[1] ?? ''
  return /^[\w.+-]+$/.test(word) ? word.toLowerCase() : ''
}

/** What a listed program can be told to run or write with no second command in sight, by
 *  the program. This is not what makes a listed program safe, which nothing can: a program
 *  on the list is trusted with all it can do, as docs/agent-native.md 8.9 says. It keeps
 *  the plainest ways out of a line that looks like a read in front of the reader's
 *  question. Short options are whole words, and `-O` takes its value attached; long ones
 *  are matched by any prefix, as git and npm both take one. */
const REACH: Record<string, { short: string[]; long: string[]; commands: string[] }> = {
  git: {
    short: ['-c', '-C', '-p', '-x', '-O'],
    long: [
      '--config-env',
      '--exec-path',
      '--git-dir',
      '--work-tree',
      '--paginate',
      '--output',
      '--ext-diff',
      '--extcmd',
      '--exec',
      '--upload-pack',
      '--receive-pack',
      '--open-files-in-pager',
    ],
    commands: ['config', 'submodule', 'bisect', 'filter-branch', 'difftool', 'mergetool'],
  },
  npm: {
    short: [],
    long: ['--script-shell', '--node-options'],
    commands: ['exec', 'x', 'explore', 'init', 'create', 'innit'],
  },
}
REACH.pnpm = { ...(REACH.npm as (typeof REACH)[string]), commands: ['exec', 'dlx', 'create', 'x'] }
REACH.yarn = { ...(REACH.npm as (typeof REACH)[string]), commands: ['exec', 'dlx', 'create'] }
REACH.bun = { ...(REACH.npm as (typeof REACH)[string]), commands: ['x', 'create'] }

/** The programs whose whole work is to fetch something and run it. */
const RUNS_WHAT_IT_FETCHES = new Set(['npx', 'pnpx', 'bunx'])

/** Whether a program's arguments stay out of what it can be told to run. */
function argumentsStay(program: string, words: readonly string[]): boolean {
  if (RUNS_WHAT_IT_FETCHES.has(program)) return false
  const reach = REACH[program]
  if (!reach) return true

  // As the shell hands them over: `"-c"`, `-'c'` and `-\c` are all `-c`.
  const plain = words.map((word) => word.replace(/["'\\]/g, ''))
  const command = plain.find((word) => !word.startsWith('-'))
  if (command !== undefined && reach.commands.includes(command)) return false

  return !plain.some((word) => {
    if (word.startsWith('--')) {
      const name = word.split('=')[0] ?? word
      return name.length > 2 && reach.long.some((one) => one.startsWith(name))
    }
    return reach.short.some((one) => word === one || (one === '-O' && word.startsWith('-O')))
  })
}

/** Whether a line goes for being on a list: its first program is on it, and its arguments
 *  do not tell that program to run or write something else. */
export function onTheList(command: string, programs: readonly string[]): boolean {
  const program = programOf(command)
  if (program === '' || !programs.some((one) => one.toLowerCase() === program)) return false

  return argumentsStay(program, command.trim().split(/\s+/).slice(1))
}

/** Whether a line starts only its first program: no second command after a `;`, an
 *  `&` or a `|`, nothing run inside it with backticks, `$(`, `(` or PowerShell's `@{`, no
 *  file written or read with `>` or `<`, nothing out of the history with `!`, and no word
 *  the shell makes into others (`$X`, `{a,b}`, `*`, `?`, `[`), which is how an option gets
 *  past the list of them in `onTheList`. Only such a line can be
 *  let through for being on an agent's list; `git status; rm -rf ~` starts `git` and is
 *  not one. Nor is a line with a control or a separator character anywhere: typed into a
 *  shell, Ctrl+U clears what came before it, Ctrl+O runs it, a backspace rubs it out and
 *  a tab completes it, so the words before Enter are not the words that run. */
export function startsOnlyOne(command: string): boolean {
  return !/[;&|`<>!(){}$*?[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(command)
}

/** What a terminal printed, as words: the escapes that colour and move things on a
 *  screen taken out, a carriage return taken out, and nothing else changed. */
export function plainOf(printed: string): string {
  let out = ''

  for (let at = 0; at < printed.length; at++) {
    const code = printed.charCodeAt(at)
    if (code === 27) {
      const next = printed[at + 1]
      if (next === '[') {
        // Control sequence: parameters, then one final character.
        at += 2
        while (at < printed.length && !/[@-~]/.test(printed[at] ?? '')) at++
      } else if (next === ']') {
        // Operating system command, ended by a bell or by ESC \.
        at += 2
        while (at < printed.length) {
          if (printed.charCodeAt(at) === 7) break
          if (printed.charCodeAt(at) === 27 && printed[at + 1] === '\\') {
            at++
            break
          }
          at++
        }
      } else at++
      continue
    }

    if (code === 10 || code === 9 || code >= 32) out += printed[at] ?? ''
  }

  return out
}
