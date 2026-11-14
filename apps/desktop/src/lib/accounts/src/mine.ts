import { account } from './account.svelte'
import { sha256, withOrWithout } from '../../platform/src/api'
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

function worn(token: string, profile: OwnProfile): void {
  if (account.accountToken !== token || !account.user) return
  account.user = { ...account.user, ...profile }
}

export async function changeProfile(changes: ProfileChanges): Promise<void> {
  const token = held()
  worn(token, await saveProfile(token, changes))
}

export async function wearFace(picture: HTMLCanvasElement, crop: Crop, view: number) {
  const token = held()
  const { s, l } = await faceFrom(picture, crop, view)
  const [small, large] = await Promise.all([sha256(s.bytes), sha256(l.bytes)])
  worn(
    token,
    await saveAvatar(token, {
      s: { ...s, hash: small },
      l: { ...l, hash: large },
    }),
  )
}

export async function removeFace(): Promise<void> {
  const token = held()
  worn(token, await dropAvatar(token))
}

export async function nameIn(space: string, nick: string): Promise<void> {
  const token = held()
  const kept = await saveNick(token, space, nick)
  const user = account.user
  if (!user || account.accountToken !== token) return
  account.user = { ...user, nicks: withOrWithout(user.nicks ?? {}, space, kept) }
}

export async function keepZone(): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!account.user || !zone || account.user.zone === zone) return
  await changeProfile({ zone })
}
