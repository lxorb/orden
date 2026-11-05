/** The search engine a browser sends a search to, as Orden's address field would choose
 *  it: one of the list (web-tab/engines.ts) by its name or its site, else the browser's
 *  own address as a custom engine, `%s` where the words go.
 *
 *  Only where somebody chose one there: Firefox and Zen write the choice as
 *  `metaData.defaultEngineId` in `search.json.mozlz4` and the engine itself among its
 *  `engines`; a Chromium as `default_search_provider_data` in the profile's
 *  `Preferences`; Safari names the one of its few it uses (safari.rs). A browser still
 *  on the engine it came with says nothing of the kind, and nothing comes.
 *
 *  Pure: the files as they were parsed in, the engine out. */

import { engineFor, isEngineAddress } from '../web-tab/engines'
import { WORDS } from '../web-tab/typed'
import { isObject, list, type Said, text } from './sidebar-made'

/** One of Orden's engines by its id, or a custom one's address; and what it is called. */
export type BrowserEngine = { name: string } & ({ id: string } | { custom: string })

/** Firefox's and Zen's. */
export function mozillaEngine(said: unknown): BrowserEngine | null {
  if (!isObject(said) || !isObject(said.metaData)) return null
  const id = text(said.metaData.defaultEngineId)
  const engine = id ? list(said.engines).find((one) => text(one.id) === id) : undefined
  if (!engine) return null

  const urls = list(engine._urls)
  const url = urls.find((one) => !text(one.type) || one.type === 'text/html') ?? urls[0]
  return chosen(text(engine._name), url ? withParams(url) : null)
}

/** A search address and the fields Firefox keeps apart from it, written into it. */
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

/** A Chromium's: Chrome's own Google is written with the address of the Google of the
 *  reader's country in front, which is google.com to anybody reading it here. */
export function chromiumEngine(said: unknown): BrowserEngine | null {
  const provider = isObject(said) ? said.default_search_provider_data : null
  const data = isObject(provider) ? provider.template_url_data : null
  if (!isObject(data)) return null

  const url = text(data.url)?.replaceAll('{google:baseURL}', 'https://www.google.com/') ?? null
  return chosen(text(data.short_name), url)
}

/** Safari's, by the name it shows. */
export function safariEngine(name: unknown): BrowserEngine | null {
  return chosen(text(name), null)
}

function chosen(name: string | null, template: string | null): BrowserEngine | null {
  const search = template?.replaceAll('{searchTerms}', WORDS) ?? null
  const listed = engineFor(name, search)
  if (listed) return { id: listed.id, name: listed.name }

  // An address with something of the browser's own still to fill in is not one a
  // search can be sent to as it is.
  if (!search || /\{[^}]*\}/.test(search) || !isEngineAddress(search)) return null
  return { custom: search, name: name ?? new URL(search.replaceAll(WORDS, '')).hostname }
}
