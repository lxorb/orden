import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../src-tauri/${name}`, import.meta.url), 'utf8')) as {
    app: { windows: Record<string, unknown>[] }
  }

const OWN = ['decorations', 'titleBarStyle', 'hiddenTitle', 'trafficLightPosition']

describe("a Mac's window", () => {
  const base = read('tauri.conf.json').app.windows
  const mac = read('tauri.macos.conf.json').app.windows

  test('is the same window as everywhere else', () => {
    const strip = (window: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(window).filter(([key]) => !OWN.includes(key)))

    expect(mac).toHaveLength(base.length)
    expect(mac.map(strip)).toEqual(base.map(strip))
  })

  test("with the system's traffic lights over the app's own bar", () => {
    expect(mac[0]).toMatchObject({ decorations: true, titleBarStyle: 'Overlay', hiddenTitle: true })
  })
})
