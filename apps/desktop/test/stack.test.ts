import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../packages/themes/src/', import.meta.url))

function files(dir: string, suffix: RegExp): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path, suffix))
    else if (suffix.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }

  return out
}

interface Sheet {
  name: string
  css: string
}

const sheets: Sheet[] = [
  ...files(SOURCE, /\.svelte$/).map((path) => ({
    name: path.slice(SOURCE.length).replace(/\\/g, '/'),
    css: [...readFileSync(path, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((one) => one[1])
      .join('\n'),
  })),
  ...files(THEMES, /\.css$/).map((path) => ({
    name: `themes/${path.slice(THEMES.length).replace(/\\/g, '/')}`,
    css: readFileSync(path, 'utf8'),
  })),
].map((one) => ({ ...one, css: one.css.replace(/\/\*[\s\S]*?\*\//g, '') }))

const ladder = [
  ...readFileSync(join(THEMES, 'tokens.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/(--z-[a-z]+):\s*(-?\d+);/g),
].map((one) => ({ name: one[1] ?? '', rung: Number(one[2]) }))

function said(property: string): { where: string; value: string }[] {
  const reading = new RegExp(String.raw`(?<![\w-])${property}\s*:\s*([^;}]+)`, 'g')

  return sheets.flatMap((one) =>
    [...one.css.matchAll(reading)].map((match) => ({
      where: one.name,
      value: (match[1] ?? '').trim(),
    })),
  )
}

const RUNG = /^var\(--z-[a-z]+\)(?: !important)?$/
const UNDER = /^calc\(var\(--z-[a-z]+\) - 1\)$/

describe('the stack', () => {
  test('is one ladder, each rung above the last', () => {
    expect(ladder.length).toBeGreaterThan(10)

    const out = ladder.filter((one, at) => at > 0 && one.rung <= (ladder[at - 1]?.rung ?? 0))
    expect(out, 'these are not above the rung before them').toEqual([])
  })

  test('the scan finds the layers', () => {
    expect(said('z-index').length).toBeGreaterThan(60)
  })

  test('and every layer stands on a rung rather than on a number of its own', () => {
    const own = said('z-index')
      .filter(({ value }) => !RUNG.test(value) && !UNDER.test(value))
      .filter(({ value }) => value !== 'calc(var(--scrim-z, var(--z-sheet)) - 1)')
      .map(({ where, value }) => `${where}: z-index: ${value}`)

    expect(own, own.join('\n')).toEqual([])
  })

  test('and so does every scrim, which names the layer it is put up under', () => {
    const own = said('--scrim-z')
      .filter(({ value }) => !RUNG.test(value))
      .map(({ where, value }) => `${where}: --scrim-z: ${value}`)

    expect(own, own.join('\n')).toEqual([])
  })

  test('and every rung a stylesheet names is on the ladder', () => {
    const known = new Set(ladder.map((one) => one.name))
    const unknown = sheets.flatMap((one) =>
      [...one.css.matchAll(/var\((--z-[a-z]+)\)/g)]
        .map((match) => match[1] ?? '')
        .filter((name) => !known.has(name))
        .map((name) => `${one.name}: ${name}`),
    )

    expect(unknown).toEqual([])
  })

  test('and no script puts a layer somewhere of its own', () => {
    const scripted = files(SOURCE, /\.(svelte|ts)$/)
      .filter((path) =>
        /\.zIndex\b|style:z-index|style="[^"]*z-index/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => path.slice(SOURCE.length).replace(/\\/g, '/'))

    expect(scripted).toEqual([])
  })
})
