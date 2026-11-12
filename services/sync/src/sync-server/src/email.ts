import type { Context } from 'hono'
import { now } from './crypto'
import { note } from './failed'
import { mailCeilings, mailNotSent, type MailRefusal } from './limits'
import type { EmailSender, Env } from './types'

const MAIL_GAP = 30 * 1000

export interface Mailable {
  ok: boolean
  refusal: MailRefusal | null
}

export async function mayMail(
  env: Env,
  address: string,
  machine: string | null,
): Promise<Mailable> {
  const last = await env.DB.prepare('select sent_at from mailed where email = ?')
    .bind(address)
    .first<{ sent_at: number }>()

  if (last && now() - last.sent_at < MAIL_GAP) return { ok: false, refusal: null }

  const refusal = await mailCeilings(env, address, machine)
  if (refusal) return { ok: false, refusal: refusal.aboutTheAddress ? null : refusal }

  await env.DB.prepare('delete from mailed where sent_at < ?')
    .bind(now() - MAIL_GAP)
    .run()

  await env.DB.prepare(
    `insert into mailed (email, sent_at) values (?, ?)
     on conflict(email) do update set sent_at = excluded.sent_at`,
  )
    .bind(address, now())
    .run()

  return { ok: true, refusal: null }
}

export async function forgetMailed(env: Env, address: string): Promise<void> {
  await env.DB.prepare('delete from mailed where email = ?').bind(address).run()
  await mailNotSent(env, address)
}

export function refusedMail(
  context: Context,
  refusal: { error: string; status: 400 | 429 | 503; retryAfter: number | null },
): Response {
  return context.json(
    { error: refusal.error },
    refusal.status,
    refusal.retryAfter ? { 'retry-after': String(refusal.retryAfter) } : {},
  )
}

export interface Mailer {
  send(to: string, subject: string, body: { text: string; html: string }): Promise<boolean>
}

function logging(): Mailer {
  return {
    send(to, subject, body) {
      // eslint-disable-next-line no-console -- the log stands in for the mail
      console.log(`[mail] ${to} - ${subject}\n${body.text}`)
      return Promise.resolve(true)
    },
  }
}

function cloudflare(binding: EmailSender, from: string): Mailer {
  const named = sender(from)

  return {
    async send(to, subject, body) {
      try {
        await binding.send({ from: named, to, subject, text: body.text, html: body.html })
        return true
      } catch (error) {
        note('mail', error, null)
        return false
      }
    },
  }
}

export function sender(from: string): string | { name: string; email: string } {
  const parts = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(from.trim())
  if (!parts) return from.trim()

  const name = (parts[1] ?? '').trim().replace(/^"(.*)"$/, '$1')
  const email = parts[2] ?? ''
  return name ? { name, email } : email
}

export function mailer(env: Env): Mailer {
  if (!env.EMAIL || !env.MAIL_FROM) return logging()
  return cloudflare(env.EMAIL, env.MAIL_FROM)
}

function codeMail(code: string, subject: string, what: string, unasked: string) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`

  return {
    subject,
    text: `${what} is ${spaced}. It expires in 10 minutes.\n\n${unasked}`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;color:#1a1d23">
  <p>${what}:</p>
  <p style="font-family:ui-monospace,monospace;font-size:30px;letter-spacing:.18em;font-weight:600">${spaced}</p>
  <p style="color:#8a93a2">It expires in 10 minutes. ${unasked}</p>
</div>`,
  }
}

export function codeMessage(code: string) {
  return codeMail(
    code,
    `${code} is your Orden code`,
    'Your sign-in code',
    'If you did not ask for it, ignore this message.',
  )
}

export function leavingMessage(code: string) {
  return codeMail(
    code,
    `${code} deletes your Orden account`,
    'Your code to delete your Orden account',
    'If you did not ask for it, somebody is signed in as you: end every other session in Settings, Account.',
  )
}

export function goneMessage() {
  const said = 'Your Orden account and everything it synced have been deleted.'
  const stays = 'The notes on your devices are still there.'
  const unasked = 'If you did not do this, somebody had your mailbox: secure it first.'

  return {
    subject: 'Your Orden account has been deleted',
    text: `${said} ${stays}\n\n${unasked}`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;color:#1a1d23">
  <p>${said} ${stays}</p>
  <p style="color:#8a93a2">${unasked}</p>
</div>`,
  }
}

export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function letter(lines: readonly string[], action: { label: string; href: string }) {
  const paragraphs = lines
    .map((line) => `  <p style="margin:0 0 14px">${escape(line)}</p>`)
    .join('\n')

  return {
    text: [...lines, '', action.href].join('\n\n'),
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.55;color:#1a1d23">
${paragraphs}
  <p style="margin:22px 0 0"><a href="${escape(action.href)}" style="display:inline-block;padding:10px 18px;border-radius:9px;background:#5b4be0;color:#fff;text-decoration:none;font-weight:600">${escape(action.label)}</a></p>
</div>`,
  }
}

export function inviteMessage(invite: {
  space: string
  from: string
  role: 'write' | 'read'
  link: string
  item?: string | null
}) {
  const what = invite.role === 'write' ? 'write in it' : 'read it'
  const named = invite.item ?? invite.space
  const kind = invite.item ? 'note' : 'space'

  return {
    subject: oneLine(`${invite.from} shared ${named} with you`),
    ...letter(
      [
        `${invite.from} shared the ${kind} ${named} with you on Orden, and you can ${what}.`,
        'Open it below. Orden emails you a code to check the address, and asks for nothing else.',
      ],
      { label: `Open the ${kind}`, href: invite.link },
    ),
  }
}

export function requestMessage(request: { space: string; who: string; link: string }) {
  return {
    subject: oneLine(`${request.who} would like to join ${request.space}`),
    ...letter(
      [`${request.who} followed your link to ${request.space} and is waiting to be let in.`],
      { label: 'Open Orden', href: request.link },
    ),
  }
}
