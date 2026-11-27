import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { distOf, entryOf, leftOut, ORDEN_APPS, ordenApp } from '../app-build'
import left from '../left-out.json'

const APP = fileURLToPath(new URL('..', import.meta.url))
const TAURI = join(APP, 'src-tauri')
const ANDROID = join(TAURI, 'gen', 'android', 'app')
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')
const gradle = read(ANDROID, 'build.gradle.kts')
const IDS: Record<string, string> = {
  orden: 'so.orden.Orden',
  notes: 'so.orden.Orden',
  todo: 'so.orden.todo',
  chat: 'so.orden.chat',
  track: 'so.orden.track',
}
const SCHEMES: Record<string, string> = {
  orden: 'orden',
  notes: 'orden',
  todo: 'orden-todo',
  chat: 'orden-chat',
  track: 'orden-track',
}
describe('the apps one project builds (#2286)', () => {
  test('are named by ORDEN_APP, and nothing else is taken', () => {
    expect(ordenApp('')).toBe('orden')
    expect(ordenApp('notes')).toBe('notes')
    expect(() => ordenApp('note')).toThrow(/ORDEN_APP=note/)
    expect(distOf('orden')).toBe('dist')
    expect(distOf('todo')).toBe('dist-todo')
  })
  test('each have their Android id, name and link scheme in the one Gradle property', () => {
    for (const app of ORDEN_APPS) {
      const row = new RegExp(String.raw`"${app}" to Triple\("([^"]+)", "([^"]+)", "([^"]+)"\)`).exec(gradle)
      expect(row, app).not.toBe(null)
      expect(row?.[1], app).toBe(IDS[app])
      expect(row?.[3], app).toBe(SCHEMES[app])
      expect(existsSync(join(ANDROID, 'src', app, 'AndroidManifest.xml')), app).toBe(true)
    }
    expect(gradle).toContain('namespace = "so.orden.Orden"')
    expect(gradle).toContain('applicationId = ordenId')
  })
  test("only Orden Notes takes over the id today's installs have", () => {
    const taking = ORDEN_APPS.filter((app) => app !== 'orden' && IDS[app] === IDS.orden)
    expect(taking).toEqual(['notes'])
  })
  test('open only their own links, so Android never asks which app to use', () => {
    const manifest = read(ANDROID, 'src', 'main', 'AndroidManifest.xml')
    expect(manifest).toContain('<data android:scheme="${ordenScheme}" />')
    expect(manifest).not.toContain('android:scheme="orden"')
  })
  test('Orden Notes leaves out the todo reminders and the Todos widget', () => {
    const notes = read(ANDROID, 'src', 'notes', 'AndroidManifest.xml')
    for (const name of ['ReminderReceiver', 'TodayWidget']) {
      expect(notes).toContain(`android:name="so.orden.Orden.${name}" tools:node="remove"`)
    }
    expect(read(APP, 'src', 'lib', 'start.ts')).toMatch(
      /if \(__ORDEN_APP__ === 'orden'\)\s+void startup[^;]*startTodos/,
    )
  })
  test('with an overlay build what its entry wrote', () => {
    for (const app of ORDEN_APPS) {
      const path = join(TAURI, `tauri.${app}.conf.json`)
      if (!existsSync(path)) continue
      const overlay = JSON.parse(read(path)) as { build: { frontendDist: string; beforeBuildCommand: string } }
      expect(overlay.build.frontendDist, app).toBe(`../${distOf(app)}`)
      const script = /pnpm (\S+)/.exec(overlay.build.beforeBuildCommand)?.[1] ?? ''
      const scripts = (JSON.parse(read(APP, 'package.json')) as { scripts: Record<string, string> }).scripts
      expect(scripts[script], app).toContain(`ORDEN_APP=${app} `)
    }
    expect(existsSync(join(TAURI, 'tauri.notes.conf.json'))).toBe(true)
  })
  test('each build their own page, and only Orden Notes shares the whole Orden’s', () => {
    expect(ORDEN_APPS.map(entryOf)).toEqual(['index.html', 'index.html', 'todo.html', 'chat.html', 'track.html'])
    const config = read(APP, 'vite.config.ts')
    expect(config).toContain('{ main: resolve(import.meta.dirname, entryOf(app)) }')
    expect(config).not.toMatch(/'notes'|"notes"/)
  })
  test('with a page have all of an overlay, a list of what they leave out and a build script, or none of them', () => {
    const scripts = (JSON.parse(read(APP, 'package.json')) as { scripts: Record<string, string> }).scripts
    const built: string[] = []
    for (const app of ORDEN_APPS.filter((one) => one !== 'orden')) {
      const parts = {
        page: existsSync(join(APP, entryOf(app))),
        overlay: existsSync(join(TAURI, `tauri.${app}.conf.json`)),
        list: leftOut(app).length > 0,
        script: `build:${app}` in scripts,
      }
      const held = Object.values(parts).filter(Boolean).length
      expect([0, 4], `${app} ${JSON.stringify(parts)}`).toContain(held)
      if (held === 4) built.push(app)
    }
    expect(built).toContain('notes')
    expect(Object.keys(left).sort()).toEqual([...built].sort())
  })
  test('run their own tests under their own build constant, with no app named in the config', () => {
    const config = read(APP, 'vitest.config.ts')
    expect(config).toContain("const APPS = ORDEN_APPS.filter((app) => app !== 'orden')")
    expect(config).toContain("define: { __ORDEN_APP__: JSON.stringify(app), __AI__: 'false' }")
    expect(config).toContain('include: [`src/**/*.${app}.test.ts`, `test/**/*.${app}.test.ts`]')
    expect(config).toContain('...APPS.map((app) => `**/*.${app}.test.ts`)')
    for (const app of ORDEN_APPS.filter((one) => one !== 'orden')) expect(config, app).not.toContain(`'${app}'`)
  })
  test('Orden Notes is checked for the modules it leaves out, on every push', () => {
    const guard = read(APP, '..', '..', 'scripts', 'app-modules.mjs')
    const kept = guard.slice(guard.indexOf('const AI = ['), guard.indexOf('export async function check'))
    const config = read(APP, 'vite.config.ts')
    const ai = /const NAMES_AI = \/([^/]+)\//.exec(config)?.[1]?.split('|') ?? []
    expect(ai.length).toBeGreaterThan(5)
    expect(kept).toContain('[...AI, ...names]')
    for (const name of ai) expect(kept, name).toContain(`'${name}'`)
    expect(guard).toContain("readFileSync(join(DESKTOP, 'left-out.json')")
    for (const name of [
      'tasks-views',
      'pass-ui',
      'chats-client',
      'terminal',
      'explorer',
      'time',
      'demo',
      'web-tab',
      'pass-sync',
      'tasks-model',
      'quick-add',
    ])
      expect(leftOut('notes'), name).toContain(name)
    expect(leftOut('orden')).toEqual([])
    const workflow = read(APP, '..', '..', '.github', 'workflows', 'check.yml')
    expect(workflow).toMatch(/run: node scripts\/app-modules\.mjs --check\n/)
    expect(guard).toContain('for (const one of app ? [app] : Object.keys(KEPT_OUT))')
    expect(guard).not.toContain("'notes'")
  })
})
