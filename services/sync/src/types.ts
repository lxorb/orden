import type { Scope } from './spaces/share'
import type { Reached } from './spaces/space'

export interface Env {
  DB: D1Database
  NOTES: R2Bucket

  ROOMS?: DurableObjectNamespace

  HUB?: DurableObjectNamespace

  CHATS?: DurableObjectNamespace
  APPS?: DurableObjectNamespace
  TURN_KEY_ID?: string
  TURN_KEY_TOKEN?: string

  MACHINES?: DurableObjectNamespace
  HOMES?: R2Bucket
  MACHINE_EGRESS?: string
  MACHINE_DEV_NIBD?: string
  MACHINE_DEV_SECRET?: string

  HETZNER_TOKEN?: string
  MACHINE_TUNNEL_TOKEN?: string
  CF_ACCOUNT_ID?: string
  MACHINE_ACCESS_ID?: string
  MACHINE_ACCESS_SECRET?: string
  MACHINE_ACCESS_TEAM?: string
  MACHINE_ACCESS_AUD?: string

  BLOG_ROOT: string
  OTHER_BLOG_ROOTS?: string
  BLOG_CNAME_TARGET: string
  APP_ORIGIN: string
  OTHER_ORIGINS?: string
  MACHINE_DOMAIN?: string

  CF_ZONE_ID?: string
  CF_API_TOKEN?: string

  ASSETS?: { fetch(request: Request): Promise<Response> }

  EMAIL?: EmailSender
  MAIL_FROM?: string
  FEEDBACK_TO?: string
  FEEDBACK_REPO?: string
  GITHUB_FEEDBACK_TOKEN?: string
  FEEDBACK_PROJECT?: string

  CRASH_READER_TOKEN?: string

  AI?: { run(model: string, input: unknown): Promise<unknown> }

  OPENAI_KEY_SECRET?: string

  SECOND_FACTOR_SECRET?: string

  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  FCM_SERVICE_ACCOUNT?: string
  APNS_KEY?: string
  APNS_KEY_ID?: string
  APNS_TEAM_ID?: string
  APNS_TOPIC?: string
  APNS_SANDBOX?: string
}

export interface EmailSender {
  send(message: {
    from: string | { name: string; email: string }
    to: string | string[]
    subject: string
    text?: string
    html?: string
  }): Promise<{ messageId?: string }>
}

export interface User {
  id: string
  email: string
  name: string | null
  created_at: number
}

export interface Guest {
  id: string
  name: string
  email: string | null
  created_at: number
}

export type Whoever = { kind: 'user'; user: User } | { kind: 'guest'; guest: Guest }

export interface Space {
  id: string
  user_id: string
  name: string
  position: number
  icon: string | null
  tint: string | null
  deleted: number
  created_at: number
  updated_at: number
  blog_enabled: number
  blog_subdomain: string | null
  blog_domain: string | null
  blog_domain_token: string | null
  blog_domain_verified_at: number | null
  blog_title: string | null
  blog_note: string | null
  bookmarks: string
  files: string
  icons: string
  tints: string
  graph: string
  excluded: string
  arranged: string
  archived: string
  site: string
  sort: string
  prepared_at?: number | null
  deleted_at: number | null
}

export interface Note {
  id: string
  space_id: string
  path: string
  seq: number
  version: number
  updated_at: number
  deleted: number
  deleted_at: number | null
  size: number
  hash: string
  front: string | null
  folder_id?: string | null
  name?: string | null
  name_key?: string | null
  kind?: string
  epoch?: number
  epoch_base?: string | null
  doc_seq?: number | null
  doc_by?: string | null
  updated_by?: string | null
  deleted_in?: number | null
  paper?: string | null
}

export interface Variables {
  who: Whoever & { program?: true; readOnly?: boolean }
  user: User
  guest: Guest
  space: Reached
  scope: Scope
}
