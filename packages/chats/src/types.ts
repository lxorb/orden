export type Who = `user:${string}` | `guest:${string}` | `program:${string}`

export type Mention = Who | 'here' | 'everyone'

export type Role = 'read' | 'write' | 'owner'

export type Posting = 'writers' | 'owner'

export type Notify = 'all' | 'mentions' | 'nothing'

export interface Pointer {
  v: 1
  chat: string
  icon?: string
  iconColor?: string
}

export interface FileRef {
  hash: string
  name: string
  size: number
  type: string
  width?: number
  height?: number
  preview?: string
  seconds?: number
  wave?: number[]
}

export interface Preview {
  url: string
  title: string
  site?: string
  text?: string
  picture?: string
}

export interface Poll {
  question: string
  answers: string[]
  several: boolean
  ends?: number
}

export interface Post {
  kind: 'post'
  id: string
  message: string
  body: string
  parent?: string
  quote?: string
  files?: FileRef[]
  poll?: Poll
  preview?: Preview
  via?: { agent: string }
  alsoToChat?: boolean
  mentions?: Mention[]
}

export type Event =
  | Post
  | { kind: 'edit'; id: string; target: string; body: string; files?: FileRef[] }
  | { kind: 'delete'; id: string; target: string }
  | { kind: 'react'; id: string; target: string; emoji: string; on: boolean }
  | { kind: 'pin'; id: string; target: string; on: boolean }
  | { kind: 'vote'; id: string; target: string; answers: number[] }
  | { kind: 'meta'; id: string; topic?: string; posting?: Posting; slowmode?: number }
  | { kind: 'schedule'; id: string; sendAt: number; post: Post }

export interface Placed {
  seq: number
  at: number
  author: Who
  device?: string
  madeAt?: number
}

export type Logged = Event & Placed

export interface Wording {
  body: string
  at: number
}

export interface Message {
  id: string
  seq: number
  at: number
  author: Who
  body: string
  parent?: string
  quote?: string
  alsoToChat: boolean
  files: FileRef[]
  poll?: Poll & { votes: Record<Who, number[]> }
  preview?: Preview
  via?: { agent: string }
  mentions: Mention[]
  reactions: Record<string, Who[]>
  pinned: boolean
  editedAt?: number
  history: Wording[]
  deleted: boolean
  replies: number
  lastReplyAt?: number
}

export interface Meta {
  topic: string
  posting: Posting
  slowmode: number
}

export interface Member {
  who: Who
  name: string
  nick?: string
}
