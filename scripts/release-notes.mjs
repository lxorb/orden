#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const STABLE = /^v\d+\.\d+\.\d+$/

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const subjectOf = (line) => /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(line)

const issuesIn = (text) => [...text.matchAll(/#(\d+)/g)].map((found) => found[1])

const told = (text) => {
  const plain = text.replace(/\s*\((?:#\d+(?:,\s*)?)+\)\s*$/, '').trim()
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

function releaseNotes(subjects, since) {
  const parsed = subjects.map(subjectOf).filter((one) => one !== null)
  const fixes = parsed.filter(([, kind]) => kind === 'fix').map(([, , text]) => text)
  const bugs = new Set(fixes.flatMap((text) => issuesIn(text).map((n) => `#${n}`)))
  const unnamed = fixes.filter((text) => issuesIn(text).length === 0).length
  const fixed = bugs.size + unnamed
  const added = parsed.filter(([, kind]) => kind === 'feat').map(([, , text]) => `- ${told(text)}`)
  const lines = [`**${fixed} ${fixed === 1 ? 'bug' : 'bugs'} fixed** since ${since}.`]
  if (added.length > 0) lines.push('', '### New', '', ...added)
  return `${lines.join('\n')}\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2] ?? ''
  if (STABLE.test(tag)) {
    const before = git('tag', '--list', 'v*', '--sort=-version:refname', '--merged', `${tag}^`)
      .split('\n')
      .find((one) => STABLE.test(one) && one !== tag)
    const range = before ? `${before}..${tag}` : tag
    const subjects = git('log', '--format=%s', range).split('\n').filter(Boolean)
    process.stdout.write(releaseNotes(subjects, before ?? 'the first release'))
  }
}
