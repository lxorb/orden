export const SPACE = 'Kestrel'
export const ROOT = `/${SPACE}`
export const CANVAS = 'Board.canvas'
export const PLAN = 'Plan.md'
export const PRESS = 'Press kit.md'
export const LAUNCH = 'Launch'
export const BASE: string = import.meta.env.BASE_URL
export const PAGE = `${BASE}demo/web/kestrel.html`
export const PAGE_TITLE = 'Kestrel One'
export const ROUTES = `${BASE}demo/web/routes.html`
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
export const SPEC = 'Spec sheet.pdf'
export const RIDE_DATA = 'Ride data.md'
export const REPORT = 'Ride report.md'
export const INTERVIEWS = 'Research/Interviews.md'
export const CHECKLIST = 'Launch/Checklist.md'
const RIDE_TEXT = `# Ride data

Average speed on the river loop:

$$
v = \\frac{14\\ \\text{km}}{0.8\\ \\text{h}}
$$

\`\`\`js
const loop = { km: 14, minutes: 48 }
\`\`\`
`
export const NOTES: Readonly<Record<string, string>> = {
  [RIDE_DATA]: RIDE_TEXT,
  [REPORT]: '',
  [PLAN]: PLAN_TEXT,
  [PRESS]: `# Press kit

- One photo per colour
- The ride test, in numbers
- Quotes from Mara and Jonas
`,
  [INTERVIEWS]: `# Interviews

Twelve riders, four weeks. Most ride under 8 km and carry the bike up stairs.
`,
  'Research/Routes.md': `# Routes

River loop, old town, harbour. All flat, all under an hour.
`,
  'Design/Brand voice.md': `# Brand voice

Calm, quick, a little dry. Say it in fewer words.
`,
  [CHECKLIST]: `# Checklist

- [x] Frame colours
- [ ] Ride test
- [ ] Shop window
`,
}
export const NEIGHBOURS: readonly { name: string; notes: Readonly<Record<string, string>> }[] = [
  {
    name: 'Harbor',
    notes: {
      'Opening week.md': `# Opening week

- Tables on the quay from Friday
- Bread from the bakery on Seestrasse
- Two more hands for Saturday
`,
      'Menu.md': `# Menu

Fish soup, rye bread, plum cake. Coffee all day.
`,
    },
  },
  {
    name: 'Field notes',
    notes: {
      'Birds.md': `# Birds

Grey heron at the reeds, 07:40. Two kingfishers by the bridge.
`,
      'Walks.md': `# Walks

Lake path, 6 km. Forest loop, 9 km. Both before breakfast.
`,
    },
  },
]
