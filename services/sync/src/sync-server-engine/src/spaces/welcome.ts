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

export function welcomeNote(): string {
  return EN
}
