import { describe, expect, it } from 'vitest'
import { wifiUri } from './wifi'

describe('wifiUri', () => {
  it('names the security as phones read it', () => {
    expect(wifiUri('Home', 'secret', 'wpa2')).toBe('WIFI:T:WPA;S:Home;P:secret;;')
    expect(wifiUri('Home', 'secret', 'wpa')).toBe('WIFI:T:WPA;S:Home;P:secret;;')
    expect(wifiUri('Home', 'secret', 'wpa3')).toBe('WIFI:T:WPA;S:Home;P:secret;;')
    expect(wifiUri('Home', 'secret', 'wep')).toBe('WIFI:T:WEP;S:Home;P:secret;;')
    expect(wifiUri('Cafe', 'ignored', 'none')).toBe('WIFI:T:nopass;S:Cafe;;')
  })

  it('escapes the characters the format uses', () => {
    expect(wifiUri(String.raw`a;b,c"d:e\f`, 'p;w:"', 'wpa2')).toBe(
      String.raw`WIFI:T:WPA;S:a\;b\,c\"d\:e\\f;P:p\;w\:\";;`,
    )
  })
})
