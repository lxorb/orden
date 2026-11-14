import { frontMatterBlock } from '@orden/markdown/front-matter'
import { views } from '../../../views.svelte'
import { workspace } from '../../../workspace.svelte'
import { languageNames, type Verb } from '../rewrite'
import type { Thread } from '../../../ai-providers/src/api'
import { type Host, sendHere } from './host'

export function languageIn(
  typed: string,
  inEnglish: (id: string) => string = englishName,
): string | null {
  const want = typed.trim().toLowerCase()
  if (!want) return null
  const found = languageNames().find(
    (one) =>
      one.id.toLowerCase() === want ||
      one.name.toLowerCase() === want ||
      inEnglish(one.id).toLowerCase() === want,
  )
  return found?.id ?? null
}

function englishName(id: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(id) ?? id
  } catch {
    return id
  }
}

export async function rewrite(verb: Verb, language = ''): Promise<boolean> {
  const view = views.of(workspace.panes.focusedId)
  if (!view || view.state.readOnly) return false
  if (view.state.selection.main.empty) {
    const doc = view.state.doc.toString()
    const from = frontMatterBlock(doc)?.to ?? 0
    if (from >= doc.length) return false
    view.dispatch({ selection: { anchor: from, head: doc.length } })
  }
  const { rewriting } = await import('../rewriting.svelte')
  rewriting.show(view)
  const id = languageIn(language)
  rewriting.language = id ?? rewriting.language
  rewriting.run(verb)
  return true
}

function about(named: string): string {
  const name = named.trim().replace(/^\[\[|\]\]$/g, '')
  return name
    ? `the note [[${name}]]`
    : 'the selection, or the note in front if nothing is selected'
}

function explainPrompt(): string {
  return `Explain ${about('')}: what it means and why, briefly, in the language it is written in.`
}

function summarizePrompt(named: string): string {
  return [
    `Write a summary of ${about(named)} of a few sentences,`,
    'and add it to that note under its first heading (at the top where it has none) with edit_note.',
    'Change nothing else in it.',
  ].join(' ')
}

function reviewPrompt(target: string): string {
  if (target.trim().toLowerCase() === 'changes') {
    return 'Review the changes you made to notes in this thread: say what is wrong or missing in each, and fix what should be fixed with edit_note.'
  }
  return [
    `Review ${about(target)} for clarity, for claims that need support, and for structure.`,
    'Make each suggestion as a small edit to the note with edit_note, so it can be kept or undone one by one,',
    'and list them briefly in your answer.',
  ].join(' ')
}

export function explain(host: Host, thread: Thread | null): void {
  sendHere(host, thread, explainPrompt())
}

export function summarize(host: Host, thread: Thread | null, named: string): void {
  sendHere(host, thread, summarizePrompt(named), { mode: 'auto' })
}

export function review(host: Host, thread: Thread | null, target: string): void {
  sendHere(host, thread, reviewPrompt(target), { mode: 'auto' })
}
