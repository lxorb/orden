export interface Env {
  DB: D1Database
  NOTES: R2Bucket

  /** Root domain that hands out free blog subdomains. */
  BLOG_ROOT: string
  /** The host a domain of one's own is CNAMEd to. One fixed name inside
   *  BLOG_ROOT that publishes nothing itself; its label is reserved. Also the
   *  zone's fallback origin for Cloudflare for SaaS. */
  BLOG_CNAME_TARGET: string
  APP_ORIGIN: string

  /** Cloudflare for SaaS, which issues certificates for domains people bring:
   *  the zone that holds the custom hostnames, and a token allowed to edit
   *  them. Absent in tests and local development, where a domain is recorded
   *  and no certificate is asked for. */
  CF_ZONE_ID?: string
  CF_API_TOKEN?: string

  /** The built web app. Absent in tests, which never ask for it. */
  ASSETS?: { fetch(request: Request): Promise<Response> }

  /** Cloudflare Email Sending. Absent in tests, where codes are logged. */
  EMAIL?: EmailSender
  MAIL_FROM?: string
}

/** The `send_email` binding's surface, which workers-types does not yet cover. */
export interface EmailSender {
  send(message: {
    from: string
    to: string | string[]
    subject: string
    text?: string
    html?: string
  }): Promise<{ messageId?: string }>
}

export interface User {
  id: string
  email: string
  /** Shown on anything the account publishes. Null until chosen. */
  name: string | null
  created_at: number
}

export interface Space {
  id: string
  user_id: string
  name: string
  /** Where it sits in the rail. Ties are broken by created_at. */
  position: number
  /** The name of the icon the rail shows, if one was chosen. */
  icon: string | null
  /** A deleted space stays as a marker, so every machine learns it went. */
  deleted: number
  created_at: number
  updated_at: number
  blog_enabled: number
  blog_subdomain: string | null
  blog_domain: string | null
  blog_title: string | null
  /** When set, the only note published, shown at the root. */
  blog_note: string | null
}

export interface Note {
  id: string
  space_id: string
  path: string
  seq: number
  version: number
  updated_at: number
  deleted: number
  size: number
  hash: string
}

export type Variables = { user: User }
