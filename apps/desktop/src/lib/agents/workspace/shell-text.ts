/** A command line and what a terminal printed, as words. Pure; see terminal.ts. */

/** The program a command line starts, as a list of allowed programs names it: the first
 *  word in lower case, and only where it is a bare name the shell looks up on its path.
 *  A word with a folder, an ending or a quote is whatever file that names - `./git`,
 *  `/tmp/x/git.sh`, `"git"/../../bin/sh` - and no program on any list: the empty name. */
export function programOf(command: string): string {
  const word = /^\s*(\S+)/.exec(command)?.[1] ?? ''
  return /^[\w.+-]+$/.test(word) ? word.toLowerCase() : ''
}

/** Whether a line's first program is on a list. */
export function onTheList(command: string, programs: readonly string[]): boolean {
  const program = programOf(command)
  return program !== '' && programs.some((one) => one.toLowerCase() === program)
}

/** Whether a line starts only its first program: no second command after a `;`, an
 *  `&` or a `|`, nothing run inside it with backticks, `$(` or `(`, no file written or
 *  read with `>` or `<`, and nothing out of the history with `!`. Only such a line can be
 *  let through for being on an agent's list; `git status; rm -rf ~` starts `git` and is
 *  not one. Nor is a line with a control or a separator character anywhere: typed into a
 *  shell, Ctrl+U clears what came before it, Ctrl+O runs it, a backspace rubs it out and
 *  a tab completes it, so the words before Enter are not the words that run. */
export function startsOnlyOne(command: string): boolean {
  return !/[;&|`<>!()]|\$\(|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(command)
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
