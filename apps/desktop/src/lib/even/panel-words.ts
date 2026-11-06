import { drawsScript, undrawable } from '@orden/glasses'
import { i18n, t } from '../i18n.svelte'

const MOST_MISSING = 0.1

const SAMPLE = ['Settings', 'Switch space', 'Change note', 'Voice off', 'Spaces', 'Notes']

let decided: { language: string; drawable: boolean } | null = null

function scriptOf(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).maximize().script
  } catch {
    return undefined
  }
}

export function panelDrawable(): boolean {
  const language = i18n.language
  if (decided?.language === language) return decided.drawable

  const script = scriptOf(language)
  const drawable = script
    ? drawsScript(script)
    : undrawable(SAMPLE.map((one) => t(one)).join(' ')) <= MOST_MISSING

  decided = { language, drawable }
  return drawable
}

function fill(text: string, values?: Record<string, string | number>): string {
  if (!values) return text

  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const found = values[name]
    return found === undefined ? whole : String(found)
  })
}

export function panelWord(text: string, values?: Record<string, string | number>): string {
  return panelDrawable() ? t(text, values) : fill(text, values)
}

export function forgetPanelLanguage(): void {
  decided = null
}
