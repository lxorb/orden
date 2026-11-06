import { engineFor, isEngineAddress } from '../web-tab/engines'
import { WORDS } from '../web-tab/typed'
import { isObject, list, type Said, text } from './sidebar-made'

export type BrowserEngine = { name: string } & ({ id: string } | { custom: string })

export function mozillaEngine(said: unknown): BrowserEngine | null {
  if (!isObject(said) || !isObject(said.metaData)) return null
  const id = text(said.metaData.defaultEngineId)
  const engine = id ? list(said.engines).find((one) => text(one.id) === id) : undefined
  if (!engine) return null

  const urls = list(engine._urls)
  const url = urls.find((one) => !text(one.type) || one.type === 'text/html') ?? urls[0]
  return chosen(text(engine._name), url ? withParams(url) : null)
}

function withParams(url: Said): string | null {
  const template = text(url.template)
  if (!template) return null
  const params = list(url.params).flatMap((one) => {
    const name = text(one.name)
    return name && typeof one.value === 'string' ? [`${name}=${one.value}`] : []
  })
  if (!params.length) return template
  return `${template}${template.includes('?') ? '&' : '?'}${params.join('&')}`
}

export function chromiumEngine(said: unknown): BrowserEngine | null {
  const provider = isObject(said) ? said.default_search_provider_data : null
  const data = isObject(provider) ? provider.template_url_data : null
  if (!isObject(data)) return null

  const url = text(data.url)?.replaceAll('{google:baseURL}', 'https://www.google.com/') ?? null
  return chosen(text(data.short_name), url)
}

export function safariEngine(name: unknown): BrowserEngine | null {
  return chosen(text(name), null)
}

function chosen(name: string | null, template: string | null): BrowserEngine | null {
  const search = template?.replaceAll('{searchTerms}', WORDS) ?? null
  const listed = engineFor(name, search)
  if (listed) return { id: listed.id, name: listed.name }

  if (!search || /\{[^}]*\}/.test(search) || !isEngineAddress(search)) return null
  return { custom: search, name: name ?? new URL(search.replaceAll(WORDS, '')).hostname }
}
