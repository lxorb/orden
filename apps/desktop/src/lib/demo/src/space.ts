export const SPACE = 'Kestrel'
export const ROOT = `/${SPACE}`
export const CANVAS = 'Board.canvas'
export const PLAN = 'Plan.md'
export const PRESS = 'Press kit.md'
export const LAUNCH = 'Launch'
export const PAGE = '/demo/web/kestrel.html'
export const ROUTES = '/demo/web/routes.html'
export const PICTURES = ['Design/bike.svg', 'Design/route.svg'] as const
export const PLAN_TEXT = `# Launch plan

## This week
- Final photos of the Kestrel One

## Press
- Embargo lifts Thursday 08:00
`
export const WRITTEN = [
  { after: '- Final photos of the Kestrel One', words: 'Book the river loop for the ride test' },
  { after: '- Embargo lifts Thursday 08:00', words: 'Send the kit to three city blogs' },
] as const
export const NOTES: Readonly<Record<string, string>> = {
  [PLAN]: PLAN_TEXT,
  [PRESS]: `# Press kit

- One photo per colour
- The ride test, in numbers
- Quotes from Mara and Jonas
`,
  'Research/Interviews.md': `# Interviews

Twelve riders, four weeks. Most ride under 8 km and carry the bike up stairs.
`,
  'Research/Routes.md': `# Routes

River loop, old town, harbour. All flat, all under an hour.
`,
  'Design/Brand voice.md': `# Brand voice

Calm, quick, a little dry. Say it in fewer words.
`,
  'Launch/Checklist.md': `# Checklist

- [x] Frame colours
- [ ] Ride test
- [ ] Shop window
`,
}
