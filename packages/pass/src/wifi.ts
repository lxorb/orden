import type { WifiSecurity } from './types'

function escaped(text: string): string {
  return text.replace(/[\\;,":]/g, (one) => `\\${one}`)
}

function typeOf(security: WifiSecurity): string {
  switch (security) {
    case 'wpa':
    case 'wpa2':
    case 'wpa3':
      return 'WPA'
    case 'wep':
      return 'WEP'
    case 'none':
      return 'nopass'
  }
}

export function wifiUri(ssid: string, password: string, security: WifiSecurity): string {
  const secret = security === 'none' ? '' : `P:${escaped(password)};`
  return `WIFI:T:${typeOf(security)};S:${escaped(ssid)};${secret};`
}
