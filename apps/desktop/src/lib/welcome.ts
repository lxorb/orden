export const WELCOME_SPACE = 'Notes'

export const WELCOME_NAME = 'Read me.md'

export const WELCOME_PATH = `/${WELCOME_SPACE}/${WELCOME_NAME}`

const IMPORT_LINE = '\n[Import from Obsidian or Notion](nib://settings/import)\n'

export const WELCOME = `# Welcome to Orden

Your notes live on this device until you sign in
and turn on syncing, and then they follow you everywhere.

- Everything is markdown, and nothing else
- **Bold**, *italic*, ==highlight==, \`code\`
- $E = mc^2$ renders as you type

\`\`\`js
const hello = 'world'
\`\`\`

| What | Where |
| ---- | ----- |
| Notes | this device |
| Synced notes | your account |
`

const AS_NIBEDITOR = WELCOME.replace('# Welcome to Orden', '# Welcome to nibeditor')
const AS_NIB = WELCOME.replace('# Welcome to Orden', '# Welcome to Nib')

const EARLIER = [
  AS_NIBEDITOR,
  AS_NIB,
  AS_NIB.replace(
    'Your notes live on this device',
    'This is the browser version. Your notes live in this browser',
  ).replace('| this device |', '| this browser |'),
]

export function isUntouchedWelcome(path: string, content: string): boolean {
  const name = path.split(/[\\/]/u).at(-1) ?? ''
  if (name !== WELCOME_NAME) return false
  return [WELCOME, ...EARLIER].some((seed) => content === seed || content === seed + IMPORT_LINE)
}
