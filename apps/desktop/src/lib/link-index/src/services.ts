import type { OpenNote } from '@orden/contracts'
import type { FileDrawing, NoteIndex } from '@orden/editor'
import type { Canvas } from '@orden/markdown/canvas'
import type { Hit } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'

type BaseAsk = Parameters<NonNullable<NoteIndex['mountBase']>>[1]

type FileDrawer = (card: HTMLElement, file: FileDrawing & { root: string }) => () => void

type BaseMounter = (
  host: HTMLElement,
  ask: BaseAsk,
  from: string | null,
  stranger: boolean,
) => () => void

interface DrawnPlane {
  relinked(change: (canvas: Canvas) => Canvas): boolean
}

type SpaceSearch = (
  root: string,
  query: Query,
  terms: string[],
  limit: number,
  found: (batch: { hits: Hit[] }) => void,
  excluded: readonly string[],
) => Promise<void>

interface LinkServices {
  readonly html: (text: string, path: string | null) => Promise<string>
  readonly files: () => Promise<FileDrawer>
  readonly bases: () => Promise<BaseMounter>
  readonly plane: (note: OpenNote) => Promise<DrawnPlane | null>
  readonly search: SpaceSearch
}

const nothing = () => () => undefined

let served: LinkServices = {
  html: () => Promise.resolve(''),
  files: () => Promise.resolve(nothing),
  bases: () => Promise.resolve(nothing),
  plane: () => Promise.resolve(null),
  search: () => Promise.resolve(),
}

export function serveLinks(part: Partial<LinkServices>): void {
  served = { ...served, ...part }
}

export const services = (): LinkServices => served
