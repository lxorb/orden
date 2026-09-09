import { now } from './crypto'
import type { EmailSender, Env } from './types'

/** How long an address waits between two messages about sharing. The same gap
 *  the sign-in code keeps, and kept per address for the same reason: it is the
 *  person receiving it who is being protected, whoever asked for the send. */
const MAIL_GAP = 30 * 1000

/** Whether this address may be written to now, marking it as written to when it
 *  may. One call rather than a question and an answer, so nothing can ask, be
 *  told no, and send anyway. */
export async function mayMail(env: Env, address: string): Promise<boolean> {
  const last = await env.DB.prepare('select sent_at from mailed where email = ?')
    .bind(address)
    .first<{ sent_at: number }>()

  if (last && now() - last.sent_at < MAIL_GAP) return false

  // Rows past the gap say nothing any more, so they go as new ones arrive - the
  // way the sessions and the sign-in codes are cleared. One row per address ever
  // written to would otherwise be kept for ever to answer a question about the
  // last thirty seconds.
  await env.DB.prepare('delete from mailed where sent_at < ?')
    .bind(now() - MAIL_GAP)
    .run()

  await env.DB.prepare(
    `insert into mailed (email, sent_at) values (?, ?)
     on conflict(email) do update set sent_at = excluded.sent_at`,
  )
    .bind(address, now())
    .run()

  return true
}

export interface Mailer {
  send(to: string, subject: string, body: { text: string; html: string }): Promise<void>
}

/** Without the binding - local dev and tests - codes go to the log. */
function logging(): Mailer {
  return {
    send(to, subject, body) {
      // The log is the mailbox here; without it there is no way to sign in
      // locally, and the tests read the code back out of it.
      // eslint-disable-next-line no-console -- the log stands in for the mail
      console.log(`[mail] ${to} - ${subject}\n${body.text}`)
      return Promise.resolve()
    },
  }
}

/** Cloudflare Email Sending. No API key: the binding is the credential, and
 *  SPF, DKIM and DMARC come from the enabled sending domain. */
function cloudflare(sender: EmailSender, from: string): Mailer {
  return {
    async send(to, subject, body) {
      await sender.send({ from, to, subject, text: body.text, html: body.html })
    },
  }
}

export function mailer(env: Env): Mailer {
  if (!env.EMAIL || !env.MAIL_FROM) return logging()
  return cloudflare(env.EMAIL, env.MAIL_FROM)
}

export function codeMessage(code: string) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`

  return {
    subject: `${code} is your Nib code`,
    text: `Your sign-in code is ${spaced}. It expires in 10 minutes.\n\nIf you did not ask for it, ignore this message.`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;color:#1a1d23">
  <p>Your sign-in code:</p>
  <p style="font-family:ui-monospace,monospace;font-size:30px;letter-spacing:.18em;font-weight:600">${spaced}</p>
  <p style="color:#8a93a2">It expires in 10 minutes. If you did not ask for it, ignore this message.</p>
</div>`,
  }
}

/** A subject is one line. Everything put into one below comes from a person - a
 *  space's name, a name somebody chose - and a line break in one of those is not
 *  part of a name; it is a second header. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Everything put into the messages below comes from a person: a space's name,
 *  an address, a name somebody chose. None of it may become markup. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The house style for a message that is not a code: a sentence or two, the one
 *  thing to do, and nothing else. Written once so that everything sharing sends
 *  looks like the same app wrote it. */
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

/** Somebody was given a space. The link is where to go; what actually opens the
 *  space is the address being proved, by the same emailed code the app signs in
 *  with, so there is nothing to sign up for first. */
export function inviteMessage(invite: {
  space: string
  from: string
  role: 'write' | 'read'
  link: string
}) {
  const what = invite.role === 'write' ? 'write in it' : 'read it'

  return {
    subject: oneLine(`${invite.from} shared ${invite.space} with you`),
    ...letter(
      [
        `${invite.from} shared the space ${invite.space} with you on Nib, and you can ${what}.`,
        'Open it below. Nib emails you a code to check the address, and asks for nothing else.',
      ],
      { label: 'Open the space', href: invite.link },
    ),
  }
}

/** Somebody followed a link that asks first, and is waiting on the owner. */
export function requestMessage(request: { space: string; who: string; link: string }) {
  return {
    subject: oneLine(`${request.who} would like to join ${request.space}`),
    ...letter(
      [`${request.who} followed your link to ${request.space} and is waiting to be let in.`],
      { label: 'Open Nib', href: request.link },
    ),
  }
}
