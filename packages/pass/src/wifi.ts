import type { WifiSecurity } from './types'

function escaped(text: string): string {
  return text.replace(/[\\;,":]/g, (one) => `\\${one}`)
}
function typeOf(security: WifiSecurity): string {
  return { wpa: 'WPA', wpa2: 'WPA', wpa3: 'WPA', wep: 'WEP', none: 'nopass' }[security]
}
export function wifiUri(ssid: string, password: string, security: WifiSecurity): string {
  const secret = security === 'none' ? '' : `P:${escaped(password)};`
  return `WIFI:T:${typeOf(security)};S:${escaped(ssid)};${secret};`
}
