import type { PropertiesMode } from '@orden/markdown/properties'
import { key } from './i18n.svelte'

export const PROPERTIES_WORDS: Record<PropertiesMode, string> = {
  properties: key('Properties'),
  source: key('Source'),
  hidden: key('Hidden'),
}
