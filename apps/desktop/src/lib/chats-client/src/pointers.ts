import type { ChatPlace } from '@orden/contracts'
import { nameOf, shownName } from '../../platform/src/api'
import { places } from './where'

export type Place = ChatPlace
export function chatName(path: string): string {
  return shownName(nameOf(path))
}
export const makePointer = async (folder: string, name: string): Promise<Place | null> =>
  (await (await places())?.make(folder, name)) ?? null
export const readPointer = async (path: string): Promise<string | null> => (await (await places())?.read(path)) ?? null
export const chatsUnder = async (path: string): Promise<string[]> => (await (await places())?.under(path)) ?? []
export const findPointers = async (
  rank: (chat: string, place: Place) => number = () => 0,
  unread: (root: string) => void = () => undefined,
): Promise<Map<string, Place>> => (await (await places())?.find(rank, unread)) ?? new Map<string, Place>()
