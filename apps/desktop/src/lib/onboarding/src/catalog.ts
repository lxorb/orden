import type { Importer, NotesFrom } from '@orden/contracts'

export interface Brand {
  id: string
  name: string
  icon: string | null
  colour: string | null
}

export type PresetSetting = 'fitTabs' | 'iconTabs' | 'byUse' | 'swipe'

export type Preset = Partial<Record<PresetSetting, boolean>>

export const SETTING_NAMES: Record<PresetSetting, string> = {
  fitTabs: 'Tabs as wide as their names',
  iconTabs: 'Show other tabs as icons',
  byUse: 'Ctrl+Tab in order of use',
  swipe: 'Swipe between pages',
}

export const CUSTOM_SETTINGS: readonly PresetSetting[] = ['fitTabs', 'iconTabs', 'byUse', 'swipe']

const LIKE_CHROME: Preset = { fitTabs: true, iconTabs: false, byUse: false }
const LIKE_SAFARI: Preset = { fitTabs: false, iconTabs: false, swipe: true }
const LIKE_ZEN: Preset = { iconTabs: true, byUse: true }

export interface Browser extends Brand {
  preset: Preset | null
  importer: Importer | null
}

const browser = (
  id: string,
  name: string,
  icon: string | null,
  colour: string | null,
  preset: Preset | null,
  importer: Importer | null = null,
): Browser => ({ id, name, icon, colour, preset, importer })

export const BROWSERS: readonly Browser[] = [
  browser('chrome', 'Chrome', 'googlechrome', '#4285F4', LIKE_CHROME, 'chrome'),
  browser('safari', 'Safari', 'safari', '#006CFF', LIKE_SAFARI, 'safari'),
  browser('edge', 'Edge', 'microsoftedge', '#0078D7', LIKE_CHROME, 'edge'),
  browser('firefox', 'Firefox', 'firefox', '#FF7139', LIKE_CHROME, 'firefox'),
  browser('zen', 'Zen', 'zenbrowser', '#F76F53', LIKE_ZEN, 'zen'),
  browser('arc', 'Arc', 'arc', '#E2626B', LIKE_ZEN, 'arc'),
  browser('brave', 'Brave', 'brave', '#FB542B', LIKE_CHROME, 'brave'),
  browser('opera', 'Opera', 'opera', '#FF1B2D', LIKE_CHROME, 'opera'),
  browser('vivaldi', 'Vivaldi', 'vivaldi', '#EF3939', LIKE_CHROME, 'vivaldi'),
  browser('opera-gx', 'Opera GX', 'operagx', '#EE2950', LIKE_CHROME, 'opera-gx'),
  browser('duckduckgo', 'DuckDuckGo', 'duckduckgo', '#DE5833', LIKE_CHROME),
  browser('librewolf', 'LibreWolf', 'librewolf', '#00ACFF', LIKE_CHROME),
  browser('floorp', 'Floorp', 'floorp', '#1F8FFF', LIKE_CHROME),
  browser('tor', 'Tor', 'torbrowser', '#7D4698', LIKE_CHROME),
]

export const MAIN_BROWSERS = ['chrome', 'safari', 'edge', 'firefox'] as const

export const LATER_BROWSERS: readonly Brand[] = [
  { id: 'orion', name: 'Orion', icon: null, colour: '#5856D6' },
  { id: 'dia', name: 'Dia', icon: null, colour: '#1C1C1C' },
  { id: 'sigmaos', name: 'SigmaOS', icon: null, colour: '#6E56CF' },
  { id: 'ladybird', name: 'Ladybird', icon: null, colour: '#2D7FF9' },
  { id: 'samsung', name: 'Samsung Internet', icon: null, colour: '#1428A0' },
  { id: 'yandex', name: 'Yandex', icon: null, colour: '#FC3F1D' },
]

export interface NotesApp extends Brand {
  bring: NotesFrom | null
}

const app = (
  id: string,
  name: string,
  icon: string | null,
  colour: string | null,
  bring: NotesFrom | null,
): NotesApp => ({ id, name, icon, colour, bring })

export const NOTES_APPS: readonly NotesApp[] = [
  app('obsidian', 'Obsidian', 'obsidian', '#7C3AED', 'vault'),
  app('notion', 'Notion', 'notion', null, 'files'),
  app('apple', 'Apple Notes', 'apple', null, 'apple'),
  app('markdown', 'Markdown', 'markdown', null, 'folder'),
  app('evernote', 'Evernote', 'evernote', '#00A82D', 'files'),
  app('bear', 'Bear', null, '#DD4C4F', 'files'),
  app('keep', 'Keep', 'googlekeep', '#FFBB00', 'files'),
  app('logseq', 'Logseq', 'logseq', '#85C8C8', 'folder'),
  app('roam', 'Roam', 'roamresearch', null, 'files'),
  app('onenote', 'OneNote', 'microsoftonenote', '#7719AA', 'files'),
  app('craft', 'Craft', null, '#3E8EF7', 'files'),
  app('tomboy', 'Tomboy', null, '#E9A23B', 'folder'),
  app('journal', 'Apple Journal', null, '#1C1C1C', 'files'),
  app('joplin', 'Joplin', 'joplin', '#1071D3', null),
  app('anytype', 'Anytype', 'anytype', null, null),
  app('capacities', 'Capacities', null, '#1C1C1C', null),
  app('simplenote', 'Simplenote', 'simplenote', '#3361CC', null),
  app('heptabase', 'Heptabase', null, '#5B5BD6', null),
  app('tana', 'Tana', null, '#1C1C1C', null),
  app('workflowy', 'Workflowy', null, '#1C1C1C', null),
]

export const MAIN_NOTES = ['obsidian', 'notion', 'apple', 'markdown'] as const

export type Plan = 'claude' | 'chatgpt' | 'gemini'

export const PLANS: readonly (Brand & { id: Plan })[] = [
  { id: 'claude', name: 'Claude', icon: 'claude', colour: '#D97757' },
  { id: 'chatgpt', name: 'ChatGPT', icon: 'openai', colour: null },
  { id: 'gemini', name: 'Gemini', icon: 'googlegemini', colour: '#8E75B2' },
]

export interface Compatible extends Brand {
  baseUrl: string | null
  keyed: boolean
}

const compatible = (
  id: string,
  name: string,
  icon: string | null,
  colour: string | null,
  baseUrl: string | null,
  keyed = true,
): Compatible => ({ id, name, icon, colour, baseUrl, keyed })

export const MORE_AI: readonly Compatible[] = [
  compatible('ollama', 'Ollama', 'ollama', null, 'http://localhost:11434', false),
  compatible('lmstudio', 'LM Studio', 'lmstudio', null, 'http://localhost:1234', false),
  compatible('openrouter', 'OpenRouter', 'openrouter', null, 'https://openrouter.ai/api/v1'),
  compatible('mistral', 'Mistral', 'mistralai', '#FA520F', 'https://api.mistral.ai/v1'),
  compatible('deepseek', 'DeepSeek', 'deepseek', '#4D6BFE', 'https://api.deepseek.com/v1'),
  compatible('grok', 'Grok', 'x', null, 'https://api.x.ai/v1'),
  compatible('perplexity', 'Perplexity', 'perplexity', '#1FB8CD', null),
  compatible('copilot', 'Microsoft Copilot', null, '#0078D4', null),
  compatible('metaai', 'Meta AI', 'meta', '#0467DF', null),
]

export const HEARD = [
  { id: 'ai', name: 'AI assistant' },
  { id: 'friend', name: 'Friend or colleague' },
  { id: 'search', name: 'Search' },
  { id: 'social', name: 'Social media' },
  { id: 'other', name: 'Other' },
] as const

export type Heard = (typeof HEARD)[number]['id']

export function importPrompt(app: string): string {
  return `Convert my ${app} notes into a folder that the notes app Orden can import.

Orden imports a plain folder of Markdown files. Please produce exactly that:

1. One .md file per note, named after the note's title. Keep my ${app} hierarchy as nested folders.
2. Start every file with YAML front matter holding what ${app} knows about the note:
   ---
   created: 2024-03-01T09:30:00Z
   updated: 2024-05-12T18:02:00Z
   tags: [project, reading]
   ---
3. Write the body as GitHub-flavoured Markdown: headings, bold and italic, ==highlights==, lists, "- [ ]" and "- [x]" for to-dos, tables, fenced code with a language, and $...$ for maths.
4. Links between notes become [[Note title]]; links to a heading become [[Note title#Heading]].
5. Put images and attachments next to the note that uses them and embed them with ![[file.png]].
6. Leave out anything ${app} uses only internally (IDs, sync data, empty pages).
7. When done, zip the folder and tell me which notes, if any, you could not convert and why.

Then I open Orden, choose Import > Markdown, and pick the folder or zip.`
}
