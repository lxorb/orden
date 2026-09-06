import type { EmailSender, Env } from './types'

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
