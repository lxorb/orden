const EN = `# Welcome to Orden

Your notes live in your account, so they follow you to every device you sign in on.

- Every note is a Markdown file you own, with to-dos, bases and boards right inside
- **Bold**, *italic*, ==highlight==, \`code\`
- $E = mc^2$ renders as you type

\`\`\`js
const hello = 'world'
\`\`\`

| What | Where |
| ---- | ----- |
| This note | your Notes space |
| Everything you write | your account |
`

const DE = `# Willkommen bei Orden

Deine Notizen liegen in deinem Konto und sind auf jedem Gerät da, an dem du dich anmeldest.

- Jede Notiz ist eine Markdown-Datei, die dir gehört, mit To-dos, Bases und Boards direkt darin
- **Fett**, *kursiv*, ==hervorgehoben==, \`Code\`
- $E = mc^2$ wird beim Schreiben gesetzt

\`\`\`js
const hello = 'world'
\`\`\`

| Was | Wo |
| --- | -- |
| Diese Notiz | dein Bereich Notes |
| Alles, was du schreibst | dein Konto |
`

const GSW = `# Willkomme bi Orden

Dini Notize liege i dim Konto und sind uf jedem Grät da, wo du di aamäldisch.

- Jedi Notiz isch e Markdown-Datei, wo dir ghört, mit To-dos, Bases und Boards grad drin
- **Fett**, *kursiv*, ==markiert==, \`Code\`
- $E = mc^2$ wird gsetzt, während du schriibsch

\`\`\`js
const hello = 'world'
\`\`\`

| Was | Wo |
| --- | -- |
| Die Notiz | dini Ablag Notes |
| Alles, wo du schriibsch | dis Konto |
`

const FR = `# Bienvenue dans Orden

Vos notes vivent dans votre compte, elles vous suivent donc sur chaque appareil où vous vous connectez.

- Chaque note est un fichier Markdown qui vous appartient, avec tâches, bases et tableaux directement dedans
- **Gras**, *italique*, ==surligné==, \`code\`
- $E = mc^2$ s’affiche pendant que vous écrivez

\`\`\`js
const hello = 'world'
\`\`\`

| Quoi | Où |
| ---- | -- |
| Cette note | votre espace Notes |
| Tout ce que vous écrivez | votre compte |
`

const JA = `# Orden へようこそ

ノートはアカウントに保存され、サインインしたすべての端末に届きます。

- すべてのノートはあなたが所有する Markdown ファイルで、To-do、ベース、ボードもその中に入っています
- **太字**、*斜体*、==ハイライト==、\`コード\`
- $E = mc^2$ は入力しながら表示されます

\`\`\`js
const hello = 'world'
\`\`\`

| 何が | どこに |
| --- | --- |
| このノート | Notes スペース |
| 書いたものすべて | あなたのアカウント |
`

type Language = 'en' | 'de' | 'gsw' | 'fr' | 'ja'

const WELCOME: Record<Language, string> = { en: EN, de: DE, gsw: GSW, fr: FR, ja: JA }

const TAGS = ['gsw', 'de', 'fr', 'ja'] as const satisfies readonly Language[]

function languageOf(accepted: string | undefined): Language {
  for (const part of (accepted ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? ''
    const found = TAGS.find((one) => tag === one || tag.startsWith(`${one}-`))
    if (found) return found
  }

  return 'en'
}

export function welcomeNote(accepted: string | undefined): string {
  return WELCOME[languageOf(accepted)]
}
