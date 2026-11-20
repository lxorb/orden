import { invoke, onDisk } from '../../platform/src/api'
import { pageSizes } from '../../pdf/src/api'
import { adoptBeside as adopt, asItself as itself, asPageNote as pageNote, noteHolding } from './from-pdf'
import { turningIn } from './turning'

const drafts = () => import('./drafts')
export const draftPdf: typeof import('./drafts').draftPdf = async (ws, from) => (await drafts()).draftPdf(ws, from)
export const keepPaper: typeof import('./drafts').keepPaper = async (ws, note, path) =>
  (await drafts()).keepPaper(ws, note, path)
export const heldBy = (path: string, root: string | null): Promise<string | null> =>
  noteHolding(path, {
    root,
    exists: onDisk,
    read: (one) => invoke<string>('read_note', { path: one }).catch(() => null),
  })
export const asItself = (path: string): Promise<string> => itself(path, pageSizes)
export const asPageNote = (
  path: string,
  root: string | null,
  move: (from: string, to: string) => Promise<void>,
): Promise<string> => pageNote(path, turningIn(root, move))
export const adoptBeside = (
  path: string,
  root: string | null,
  move: (from: string, to: string) => Promise<void>,
): Promise<boolean> => adopt(path, turningIn(root, move))
