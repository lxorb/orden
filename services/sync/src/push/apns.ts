import { pemKey, signedToken } from './keys'
import type { Delivery } from './send'

export interface ApnsConfig {
  key: string
  keyId: string
  teamId: string
  topic: string
  sandbox: boolean
}

export async function sendApns(
  token: string,
  alert: { title: string; body: string; id: string },
  config: ApnsConfig,
  options: { now: number; fetch?: typeof fetch },
): Promise<Delivery> {
  const bearer = await signedToken(
    { alg: 'ES256', kid: config.keyId },
    { iss: config.teamId, iat: Math.floor(options.now / 1000) },
    await pemKey(config.key, 'ec'),
  )
  const host = config.sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'
  const answer = await (options.fetch ?? fetch)(
    `https://${host}/3/device/${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: {
        authorization: `bearer ${bearer}`,
        'apns-topic': config.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-collapse-id': alert.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        aps: {
          alert: { title: alert.title, body: alert.body },
          sound: 'default',
          category: 'nib.reminder',
        },
        id: alert.id,
      }),
    },
  )
  if (answer.status === 410) return 'gone'
  if (answer.ok) return 'sent'
  if (answer.status === 429 || answer.status === 503) return 'busy'
  const said = await answer.text()
  return /BadDeviceToken|Unregistered/.test(said) ? 'gone' : 'failed'
}
