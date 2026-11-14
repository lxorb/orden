import { api, request } from './client'
import { isRecord, isString } from '../../stored'
import type { Avatar, Presence, Status } from './face'
import { type Person, readPerson, readPresence } from './read'

export interface ProfileChanges {
  pronouns?: string | null
  bio?: string | null
  status?: Status | null
  zone?: string | null
  hidden?: boolean
}

export interface OwnProfile {
  avatar: Avatar | null
  pronouns: string | null
  bio: string | null
  status: Status | null
  zone: string | null
  hidden: boolean
}

const ids = (list: readonly string[]) => list.map(encodeURIComponent).join(',')

export async function fetchPeople(token: string, list: readonly string[]): Promise<Person[]> {
  const answer = await request<unknown>(`/v2/people?ids=${ids(list)}`, { token })
  const people = isRecord(answer) && Array.isArray(answer.people) ? answer.people : []
  return people.map(readPerson).filter((one): one is Person => one !== null)
}

export async function fetchPresence(
  token: string,
  list: readonly string[],
): Promise<Record<string, Presence>> {
  const answer = await request<unknown>(`/v2/presence?ids=${ids(list)}`, { token })
  const said = isRecord(answer) && isRecord(answer.presence) ? answer.presence : {}
  return Object.fromEntries(Object.entries(said).map(([id, state]) => [id, readPresence(state)]))
}

export async function saveProfile(token: string, changes: ProfileChanges): Promise<OwnProfile> {
  const { profile } = await request<{ profile: OwnProfile }>('/v2/me/profile', {
    method: 'PUT',
    token,
    body: changes,
  })
  return profile
}

export interface Picture {
  hash: string
  bytes: ArrayBuffer
  type: string
}

export async function saveAvatar(
  token: string,
  pictures: { s: Picture; l: Picture },
): Promise<OwnProfile> {
  await Promise.all(
    [pictures.s, pictures.l].map((one) => api.putBlob(token, one.hash, one.type, one.bytes)),
  )
  const { profile } = await request<{ profile: OwnProfile }>('/v2/me/avatar', {
    method: 'PUT',
    token,
    body: { s: pictures.s.hash, l: pictures.l.hash },
  })
  return profile
}

export async function dropAvatar(token: string): Promise<OwnProfile> {
  const { profile } = await request<{ profile: OwnProfile }>('/v2/me/avatar', {
    method: 'DELETE',
    token,
  })
  return profile
}

export async function fetchNicks(token: string, space: string): Promise<Record<string, string>> {
  const answer = await request<unknown>(`/v2/spaces/${encodeURIComponent(space)}/nicks`, {
    token,
  })
  const said = isRecord(answer) && isRecord(answer.nicks) ? answer.nicks : {}
  return Object.fromEntries(
    Object.entries(said).filter((entry): entry is [string, string] => isString(entry[1])),
  )
}

export async function saveNick(token: string, space: string, nick: string): Promise<string | null> {
  const answer = await request<{ nick: string | null }>(
    `/v2/spaces/${encodeURIComponent(space)}/nick`,
    { method: 'PUT', token, body: { nick } },
  )
  return answer.nick
}
