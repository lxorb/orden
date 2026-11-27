#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const STABLE = /^v\d+\.\d+\.\d+$/
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const subjectOf = (line) => /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(line)
const issuesIn = (text) => [...text.matchAll(/#(\d+)/g)].map((found) => found[1])
const told = (text) => {
  const plain = text.replace(/\s*\((?:#\d+(?:,\s*)?)+\)\s*$/, '').trim()
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}
function tally(subjects) {
  const parsed = subjects.map(subjectOf).filter((one) => one !== null)
  const fixes = parsed.filter(([, kind]) => kind === 'fix').map(([, , text]) => text)
  const bugs = new Set(fixes.flatMap((text) => issuesIn(text).map((n) => `#${n}`)))
  const unnamed = fixes.filter((text) => issuesIn(text).length === 0).length
  const added = parsed.filter(([, kind]) => kind === 'feat').map(([, , text]) => told(text))
  return { bugs: bugs.size + unnamed, added }
}
function releaseNotes(subjects, since) {
  const { bugs, added } = tally(subjects)
  const lines = [`**${bugs} ${bugs === 1 ? 'bug' : 'bugs'} fixed** since ${since}.`]
  if (added.length > 0) lines.push('', '### New', '', ...added.map((one) => `- ${one}`))
  return `${lines.join('\n')}\n`
}
const subjectsIn = (cwd, range) => git(cwd, 'log', '--format=%s', range).split('\n').filter(Boolean)
export function releaseHistory(cwd = process.cwd(), count = 8) {
  try {
    const tags = git(cwd, 'tag', '--list', 'v*', '--sort=-version:refname', '--merged', 'HEAD')
      .split('\n')
      .filter((one) => STABLE.test(one))
    return tags
      .slice(0, count)
      .map((tag, at) => {
        const before = tags[at + 1]
        return { version: tag.slice(1), ...tally(subjectsIn(cwd, before ? `${before}..${tag}` : tag)) }
      })
      .reverse()
  } catch {
    return []
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2] ?? ''
  if (tag === '--json') process.stdout.write(`${JSON.stringify(releaseHistory())}\n`)
  else if (STABLE.test(tag)) {
    const before = git('.', 'tag', '--list', 'v*', '--sort=-version:refname', '--merged', `${tag}^`)
      .split('\n')
      .find((one) => STABLE.test(one) && one !== tag)
    const range = before ? `${before}..${tag}` : tag
    process.stdout.write(releaseNotes(subjectsIn('.', range), before ?? 'the first release'))
  }
}
