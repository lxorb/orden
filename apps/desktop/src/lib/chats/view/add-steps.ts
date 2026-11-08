import { t } from '../../i18n.svelte'

export const ADVANCED: ReadonlySet<string> = new Set(['imapHost', 'smtpHost', 'user'])

const OAUTH = new Set(['gmail', 'microsoft'])

export function isOAuth(provider: string): boolean {
  return OAUTH.has(provider)
}

export function tileHint(provider: string): string | null {
  switch (provider) {
    case 'mail':
      return t('Any mail account, with its address and password')
    case 'gmail':
      return t('Sign in with your Google account')
    case 'microsoft':
      return t('Sign in with your work or school account')
    case 'telegram':
      return t('Your account, with a code sent to your phone')
    case 'slack':
      return t('Your own Slack app, made in one click')
    case 'whatsapp':
    case 'signal':
      return t('Linked as a device with a QR code')
    default:
      return null
  }
}

export function introOf(provider: string): string | null {
  switch (provider) {
    case 'mail':
      return t('Orden finds the servers from your address.')
    case 'gmail':
    case 'microsoft':
      return t('Orden opens the sign-in in your browser and comes back here once you allow it.')
    case 'telegram':
      return t(
        'Telegram asks for an API ID once, then sends a code to your phone or shows a QR code.',
      )
    case 'slack':
      return t('Orden makes a Slack app of your own, so nothing passes through anyone else.')
    case 'whatsapp':
    case 'signal':
      return t('Orden is linked to your phone as another device, the way a computer is.')
    default:
      return null
  }
}

export function pairingSteps(provider: string): readonly string[] {
  switch (provider) {
    case 'whatsapp':
      return [
        t('On your phone, open WhatsApp and go to Settings, then Linked devices'),
        t('Tap Link a device'),
        t('Scan the QR code Orden shows next'),
      ]
    case 'signal':
      return [
        t('On your phone, open Signal and go to Settings, then Linked devices'),
        t('Tap the plus to link a new device'),
        t('Scan the QR code Orden shows next'),
      ]
    default:
      return []
  }
}

export function submitOf(provider: string): string {
  switch (provider) {
    case 'whatsapp':
    case 'signal':
      return t('Show the QR code')
    case 'telegram':
      return t('Continue')
    default:
      return t('Connect')
  }
}

const SIGN_IN = /password|auth|login|credential|denied|token|invalid|unauthori[sz]ed|forbidden/i
const REACH =
  /ENOTFOUND|getaddrinfo|resolve|refused|unreachable|timed? ?out|timeout|network|offline|host|connect/i

export function fixFor(provider: string, reason: string): string {
  if (SIGN_IN.test(reason)) {
    if (provider === 'slack') return t('Check the token you pasted: it starts with xoxp-.')
    if (provider === 'mail')
      return t('Check the address and password. Some services ask for an app password instead.')
    return t('Sign in again and allow Orden what it asks for.')
  }
  if (REACH.test(reason)) {
    if (provider === 'mail')
      return t(
        'Orden could not reach the servers. Check your connection, or the servers under Advanced.',
      )
    return t('Orden could not reach the service. Check your connection and try again.')
  }
  return t('Change the details and try again.')
}
