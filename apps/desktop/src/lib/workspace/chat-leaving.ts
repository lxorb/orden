import { ApiError } from '../accounts/src/api'
import { onDisk, nameOf, samePath, within, joinPath } from '../platform/src/api'
import { sync } from '../sync.svelte'
import { failed } from '../views/failed.svelte'
import { workspace } from '../workspace.svelte'
import { carryQuestion } from './carry-question'
import { mayCarry, pointersMoving, spaceHolding } from './chat-carry'

export async function chatsCarried(path: string, folder: string): Promise<() => Promise<void>> {
  const none = () => Promise.resolve()
  const from = spaceHolding(path)
  const to = spaceHolding(folder)
  if (!from || !to || samePath(from.root, to.root)) return none
  const pointers = await pointersMoving(path)
  if (!pointers.length) return none

  const {
    listChats,
    moveChat,
    chatName,
    readPointer,
    keepOwnPointer,
    lastMoved,
    movedHere,
    ownPointer,
  } = await (await import('../chats-client/src/api')).chatLeaving()
  const moved: string[] = []
  const owned: [string, string][] = []
  const home = sync.remoteIdFor(from.root)
  const back = async () => {
    if (!home) return
    for (const chat of moved) {
      if (await moveChat(chat, home).catch(() => false)) movedHere(chat, home)
    }
    for (const [chat, pointer] of owned) keepOwnPointer(chat, pointer)
  }
  const refuse = async (error: Error): Promise<never> => {
    await back()
    failed.tell(() => void workspace.move(path, folder).catch(() => undefined))
    throw error
  }
  if (await onDisk(joinPath(folder, nameOf(path)))) {
    await refuse(new Error('something already lives there'))
  }
  if (!mayCarry(path, to.root, pointers)) await refuse(new Error('only the owner can do that'))
  const space = sync.remoteIdFor(to.root)
  if (!space || space === home) return none

  const listing = await listChats().catch(() => null)
  const spaces = listing ? new Map(listing.chats.map((one) => [one.id, one.space])) : null

  const carrying = new Map<string, string>()
  for (const pointer of pointers) {
    const chat = await readPointer(pointer)
    if (!chat || carrying.has(chat)) continue
    const lives = spaces ? (spaces.get(chat) ?? null) : lastMoved(chat)
    if (lives === null && !spaces) await refuse(new Error('the account could not be reached'))
    if (lives !== home) continue
    const own = ownPointer(chat)
    const staying =
      own !== null &&
      within(from.root, own) !== null &&
      !pointers.some((one) => samePath(one, own)) &&
      (await readPointer(own)) === chat
    if (!staying) carrying.set(chat, pointer)
  }
  if (!carrying.size) return none

  const names = [...carrying.values()].map((pointer) => chatName(pointer))
  const answer = await carryAsked(names, from.name, to.name)
  if (answer === null) await refuse(new Error('not moved'))
  if (answer === 'file') return none

  for (const [chat, pointer] of carrying) {
    const moving = await moveChat(chat, space).catch((error: unknown) =>
      error instanceof ApiError ? error : new Error(String(error)),
    )
    if (moving instanceof Error) await refuse(moving)
    if (moving === false) await refuse(new Error('the account could not be reached'))
    moved.push(chat)
    movedHere(chat, space)
    keepOwnPointer(chat, joinPath(folder, nameOf(path)) + pointer.slice(path.length))
    owned.push([chat, pointer])
  }
  return back
}

async function carryAsked(
  names: readonly string[],
  from: string,
  to: string,
): Promise<'chat' | 'file' | null> {
  const { prompt } = await import('../ui-kit/src/api')
  const answer = await prompt.choose(carryQuestion(names, from, to))
  return answer === 'chat' || answer === 'file' ? answer : null
}
