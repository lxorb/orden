import type { Env } from '../types'
import { sendApns } from './apns'
import { sendFcm } from './fcm'
import { sendWebPush, type SubscriptionKeys } from './webpush'

export type Delivery = 'sent' | 'gone' | 'failed' | 'busy' | 'off'

export type TargetKind = 'webpush' | 'fcm' | 'apns'

export interface Target {
  id: string
  user_id: string
  kind: TargetKind
  token: string
  keys: string | null
  zone: string | null
}

export interface Message {
  kind: 'reminder' | 'chat'
  id: string
  title: string
  body: string
  fields: Record<string, string>
}

function keysOf(target: Target): SubscriptionKeys | null {
  try {
    const keys = JSON.parse(target.keys ?? '') as Partial<SubscriptionKeys>
    return typeof keys.p256dh === 'string' && typeof keys.auth === 'string'
      ? { p256dh: keys.p256dh, auth: keys.auth }
      : null
  } catch {
    return null
  }
}

export function configured(env: Env) {
  return {
    webpush: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? env.VAPID_PUBLIC_KEY : null,
    fcm: !!env.FCM_SERVICE_ACCOUNT,
    apns: !!(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC),
  }
}

export async function push(
  env: Env,
  target: Target,
  message: Message,
  now: number,
  send: typeof fetch = (input, init) => fetch(input, init),
): Promise<Delivery> {
  const data = {
    kind: message.kind,
    id: message.id,
    title: message.title,
    body: message.body,
    ...message.fields,
  }
  let delivery: Delivery = 'off'
  try {
    if (target.kind === 'webpush') {
      const keys = keysOf(target)
      if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && keys) {
        delivery = await sendWebPush(
          target.token,
          keys,
          data,
          {
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: env.VAPID_SUBJECT ?? `mailto:${env.MAIL_FROM ?? 'nib@nibeditor.com'}`,
          },
          { now, topic: message.id, fetch: send },
        )
      }
    } else if (target.kind === 'fcm') {
      if (env.FCM_SERVICE_ACCOUNT) {
        delivery = await sendFcm(target.token, data, env.FCM_SERVICE_ACCOUNT, { now, fetch: send })
      }
    } else if (env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC) {
      delivery = await sendApns(
        target.token,
        { title: message.title, body: message.body, id: message.id },
        {
          key: env.APNS_KEY,
          keyId: env.APNS_KEY_ID,
          teamId: env.APNS_TEAM_ID,
          topic: env.APNS_TOPIC,
          sandbox: env.APNS_SANDBOX === 'true',
        },
        { now, fetch: send },
      )
    }
  } catch {
    delivery = 'busy'
  }

  if (delivery === 'gone') {
    await env.DB.prepare('delete from push_targets where id = ?').bind(target.id).run()
  } else if (delivery === 'failed' || delivery === 'busy') {
    await env.DB.prepare('update push_targets set failed_at = ? where id = ?')
      .bind(now, target.id)
      .run()
  }
  return delivery
}
