import { escape } from './email'
import type { IssueState } from './feedback-issues'

export interface PageReport {
  text: string
  sentAt: number
  filed: boolean
  state: IssueState | null
  images: readonly string[]
}

export function standing(report: Pick<PageReport, 'filed' | 'state'>): string {
  if (!report.filed) return 'Received. It is waiting to be filed for the team.'
  if (report.state === 'done') return 'Closed: this has been dealt with.'
  if (report.state === 'not planned') return 'Closed: this is not planned for now.'
  if (report.state === 'open') return 'Filed. It is open and in the queue.'
  return 'Received and filed for the team.'
}

const STYLE = `
:root { color-scheme: light dark; --bg: #f7f7f5; --card: #fff; --text: #1a1d23;
  --muted: #6b7380; --line: #e2e3e6; --accent: #2f6fde; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #16181c; --card: #1e2126; --text: #e8eaee; --muted: #959cab;
    --line: #2d3138; --accent: #7aa7ff; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 680px; margin: 0 auto; padding: 48px 16px; }
.brand { font-weight: 600; color: var(--muted); margin: 0 0 24px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  padding: 24px; }
h1 { font-size: 20px; margin: 0 0 8px; }
.state { color: var(--accent); font-weight: 600; margin: 0 0 4px; }
.when { color: var(--muted); font-size: 13px; margin: 0 0 20px; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0;
  padding-top: 20px; border-top: 1px solid var(--line); }
.images { display: grid; gap: 12px; margin-top: 20px; }
.images img { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; }
.note { color: var(--muted); font-size: 13px; margin: 20px 0 0; }
`

function page(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Your Orden report</title>
<style>${STYLE}</style>
</head>
<body><main><p class="brand">Orden</p><div class="card">${body}</div></main></body>
</html>`
}

export function reportPage(report: PageReport | null): string {
  if (!report) {
    return page(`<h1>No report here</h1>
<p class="note">This address names no report, or not with this key.</p>`)
  }
  const when = new Date(report.sentAt).toISOString().replace('T', ' ').slice(0, 16)
  const images = report.images.length
    ? `<div class="images">${report.images
        .map((url, at) => `<img src="${escape(url)}" alt="Image ${String(at + 1)}">`)
        .join('')}</div>`
    : ''
  return page(`<h1>Your report</h1>
<p class="state">${escape(standing(report))}</p>
<p class="when">Sent ${escape(when)} UTC</p>
<p class="text">${escape(report.text)}</p>
${images}
<p class="note">Only somebody with this address can see this page.</p>`)
}
