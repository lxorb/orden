import type { EditorView } from '@orden/editor'
import {
  log,
  onDisk,
  forget,
  isRecord,
  isString,
  keepJson,
  stored,
  storedText,
  invoke,
} from '../../platform/src/api'
import { applied, type Edit } from '@orden/scan/search/replace'
import { workspace } from '../../workspace.svelte'
import { writeFile } from '../../workspace/write-file'
import { closeScratchpad, shown } from './is.svelte'
import { difference, joined } from './words'

const WRITING = 'orden:scratchpad-writing'

interface Owed {
  words: string
  over: string[]
}

function owedNow(): Owed | null {
  const held = stored(WRITING)
  return isRecord(held) && isString(held.words) && Array.isArray(held.over)
    ? { words: held.words, over: held.over.filter(isString) }
    : null
}

function stamp(text: string): string {
  let hash = 2166136261
  for (let at = 0; at < text.length; at++) {
    hash = Math.imul(hash ^ text.charCodeAt(at), 16777619)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

function settled(owed: Owed, file: string): string {
  if (file === owed.words) return file
  return owed.over.includes(stamp(file)) ? owed.words : joined(file, owed.words)
}

class Scratchpad {
  private asked: Promise<string> | null = null
  private known: string | null = null
  private readonly onTheirWay = new Set<string>()
  private readonly heard = new Set<() => void>()
  live: EditorView | null = null
  line: number | null = null

  where(): Promise<string> {
    this.asked ??= invoke<string>('scratchpad_path')
      .then(async (path) => {
        await this.pay(path)
        return path
      })
      .catch((error: unknown) => {
        this.asked = null
        throw error
      })
    return this.asked
  }

  private async pay(path: string): Promise<void> {
    const owed = owedNow()
    if (!owed) return

    try {
      const file = await workspace.noteText(path)
      if (file === null && (await onDisk(path))) return
      const words = settled(owed, file ?? '')
      if (words !== file) await writeFile(path, words)
      this.known = words
      forget(WRITING)
    } catch (error) {
      log('warn', `scratchpad: what the last run owed is not written yet: ${String(error)}`)
    }
  }

  async writeDown(path: string, words: string): Promise<void> {
    const owed: Owed = { words, over: this.mayBe() }
    const mine = JSON.stringify(owed)
    if (!keepJson(WRITING, owed)) {
      forget(WRITING)
      keepJson(WRITING, owed)
    }

    await this.landed(path, words)
    if (storedText(WRITING) === mine) forget(WRITING)
    this.told()
  }

  listen(heard: () => void): () => void {
    this.heard.add(heard)
    return () => this.heard.delete(heard)
  }

  private told(): void {
    for (const heard of this.heard) heard()
  }

  private mayBe(): string[] {
    const known = this.known === null ? [] : [this.known]
    return [...known, ...this.onTheirWay].map(stamp)
  }

  private async landed(path: string, words: string): Promise<void> {
    this.onTheirWay.add(words)
    try {
      await writeFile(path, words)
      this.known = words
    } finally {
      this.onTheirWay.delete(words)
    }
  }

  show(line: number | null = null, take = true) {
    this.line = line
    shown.show(take)
  }

  async asNote(): Promise<void> {
    const path = await this.where()
    const live = this.live
    if (live) await this.writeDown(path, live.state.doc.toString())
    closeScratchpad()
    await workspace.open(path, { asNote: true })
  }

  async text(): Promise<string> {
    if (this.live) return this.live.state.doc.toString()
    return (await workspace.noteText(await this.where())) ?? ''
  }

  async append(words: string): Promise<void> {
    await this.write((before) => joined(before, words))
  }

  async replace(before: string, edits: readonly Edit[]): Promise<boolean> {
    const path = await this.where()
    const live = this.live
    const now = live ? live.state.doc.toString() : await this.toChange(path)
    if (now.replace(/\r\n?/g, '\n') !== before) return false

    live?.dispatch({ changes: [...edits] })
    const after = applied(before, edits)
    if (!live) this.intoTab(path, edits, after)
    await this.written(path, after)
    return true
  }

  async editable(): Promise<string> {
    const text = await this.toChange(await this.where())
    this.known = text
    const owed = owedNow()
    return owed ? settled(owed, text) : text
  }

  async now(): Promise<string> {
    return this.toChange(await this.where())
  }

  async takeIn(
    change: (now: string) => readonly Edit[],
    settle: (after: string) => Promise<void>,
  ): Promise<void> {
    const path = await this.where()
    const before = await this.toChange(path)
    const edits = change(before)
    const after = applied(before, edits)
    if (after !== before) {
      if (this.live) this.live.dispatch({ changes: [...edits] })
      else this.intoTab(path, edits, after)
    }
    await settle(after)
    if (after !== before) await this.written(path, after, false)
  }

  private async toChange(path: string): Promise<string> {
    if (this.live) return this.live.state.doc.toString()
    const words = await workspace.noteText(path)
    if (words !== null) return words
    if (await onDisk(path)) throw new Error(`${path} is there and would not read`)
    return ''
  }

  private async write(change: (before: string) => string): Promise<void> {
    const path = await this.where()
    const before = await this.toChange(path)
    const after = change(before)
    if (after === before) return

    const changes = difference(before, after)
    if (this.live) this.live.dispatch({ changes })
    else this.intoTab(path, [changes], after)
    await this.written(path, after)
  }

  private intoTab(
    path: string,
    changes: readonly { from: number; to: number; insert: string }[],
    after: string,
  ): void {
    workspace.documentAt(path)?.edited(changes, after)
  }

  private async written(path: string, words: string, tell = true): Promise<void> {
    const held = storedText(WRITING)
    const within = this.live !== null
    await this.landed(path, words)
    if (within && storedText(WRITING) === held) forget(WRITING)
    if (tell) this.told()
  }
}

export const scratchpad = new Scratchpad()
