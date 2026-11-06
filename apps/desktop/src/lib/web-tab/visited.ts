import { forget as forgetStored, Shared } from '../stored'
import { forget } from './favicons'
import { completion, suggested, type Completion } from './omnibox'
import {
  broughtIn,
  named,
  typedTo,
  unvisited,
  unvisitedSince,
  visitKey,
  visited as arrived,
  visitsFrom,
} from './visits'
import type { Visit } from './visits'

type Book = string

class Visited {
  private readonly books = new Map<Book, Shared<readonly Visit[]>>()

  private readonly counted = new Map<string, string>()

  private readonly watchers = new Set<(book: Book) => void>()

  watch(heard: (book: Book) => void): () => void {
    this.watchers.add(heard)
    return () => this.watchers.delete(heard)
  }

  private bookOf(book: Book): Shared<readonly Visit[]> {
    let kept = this.books.get(book)
    if (!kept) {
      kept = new Shared(book, visitsFrom)
      this.books.set(book, kept)
    }
    return kept
  }

  private rows(book: Book): readonly Visit[] {
    return this.bookOf(book).get()
  }

  private write(book: Book, next: readonly Visit[]) {
    const kept = this.bookOf(book)
    if (next === kept.get()) return

    kept.set(next, JSON.stringify(next))
    for (const heard of this.watchers) heard(book)
  }

  wake(book: Book) {
    this.rows(book)
  }

  saw(book: Book, tab: string, url: string, title: string) {
    const key = visitKey(url)
    if (key === null) return

    const now = Date.now()
    if (this.counted.get(tab) === key) {
      this.write(book, named(this.rows(book), key, title))
      return
    }

    this.counted.set(tab, key)
    this.write(book, arrived(this.rows(book), key, title, now))
  }

  typed(book: Book, url: string) {
    this.write(book, typedTo(this.rows(book), url, Date.now()))
  }

  brought(book: Book, rows: unknown) {
    this.write(book, broughtIn(this.rows(book), visitsFrom(rows)))
  }

  fold(from: Book, into: Book, rows: readonly Visit[]) {
    this.write(into, rows)
    this.books.delete(from)
    forgetStored(from)
  }

  left(tab: string) {
    this.counted.delete(tab)
  }

  remove(book: Book, url: string) {
    this.write(book, unvisited(this.rows(book), url))
    forget(url)
  }

  removeSince(book: Book, since: number): string[] {
    const rows = this.rows(book)
    const left = unvisitedSince(rows, since)
    const kept = new Set(left.map((one) => one.url))
    const gone = rows.filter((one) => !kept.has(one.url)).map((one) => one.url)
    for (const url of gone) forget(url)
    this.write(book, left)
    return gone
  }

  titleOf(book: Book, url: string): string {
    const key = visitKey(url)
    return this.rows(book).find((one) => one.url === key)?.title ?? ''
  }

  complete(book: Book, typed: string): Completion | null {
    return completion(this.rows(book), typed, Date.now())
  }

  all(book: Book): readonly Visit[] {
    return this.rows(book)
  }

  suggest(book: Book, typed: string): Visit[] {
    return suggested(this.rows(book), typed, Date.now())
  }
}

export const visited = new Visited()
