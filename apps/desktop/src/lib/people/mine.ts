import { account } from '../account.svelte'
import { sha256 } from '../bytes'
import { withOrWithout } from '../records'
import {
  dropAvatar,
  type OwnProfile,
  type ProfileChanges,
  saveAvatar,
  saveNick,
  saveProfile,
} from './calls'
import type { Crop } from './crop'
import { faceFrom } from './encode'

function held(): string {
  const token = account.accountToken
  if (!token) throw new Error('sign in first')
  return token
}

function worn(profile: OwnProfile): void {
  if (account.user) account.user = { ...account.user, ...profile }
}

export async function changeProfile(changes: ProfileChanges): Promise<void> {
  worn(await saveProfile(held(), changes))
}

export async function wearFace(picture: HTMLCanvasElement, crop: Crop, view: number) {
  const token = held()
  const { s, l } = await faceFrom(picture, crop, view)
  const [small, large] = await Promise.all([sha256(s.bytes), sha256(l.bytes)])
  worn(
    await saveAvatar(token, {
      s: { ...s, hash: small },
      l: { ...l, hash: large },
    }),
  )
}

export async function removeFace(): Promise<void> {
  worn(await dropAvatar(held()))
}

export async function nameIn(space: string, nick: string): Promise<void> {
  const kept = await saveNick(held(), space, nick)
  const user = account.user
  if (user) account.user = { ...user, nicks: withOrWithout(user.nicks ?? {}, space, kept) }
}

export async function keepZone(): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!account.user || !zone || account.user.zone === zone) return
  await changeProfile({ zone })
}
