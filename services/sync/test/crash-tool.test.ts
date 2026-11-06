import { describe, expect, test } from 'vitest'

interface Resolved {
  symbol: string
  location: string
}

interface Tool {
  issueTitle(group: { kind: string; title: string }): string
  issueBody(group: unknown, id: string, report: unknown, symbols?: Map<string, Resolved>): string
  fenced(text: string, language?: string): string
  parseSymbolized(output: string): (Resolved | null)[]
  framesToSymbolize(report: unknown, symbolsFile: string): Map<string, string>
}

const TOOL = new URL('../../../scripts/crash-reports.mjs', import.meta.url).href
const tool = (await import(TOOL)) as Tool

const GROUP = {
  signature: '0123456789abcdef',
  kind: 'freeze',
  title: '41 s in web_open, killed',
  firstAt: Date.UTC(2026, 10, 1),
  lastAt: Date.UTC(2026, 10, 5),
  count: 3,
  versions: ['0.20.1', '0.20.2'],
  platforms: ['Windows'],
  issue: null,
}

const REPORT = {
  v: 1,
  id: 'a'.repeat(32),
  kind: 'freeze',
  at: Date.UTC(2026, 10, 5, 12),
  app: { version: '0.20.2', channel: 'unstable', build: 'abc' },
  system: { os: 'Windows', osVersion: '10.0.26100', arch: 'x86_64', engine: 'WebView2 131' },
  summary: 'the window stopped answering',
  doing: 'web_open',
  held: 41_200,
  killed: true,
  threads: [
    { name: 'worker', frames: [{ module: 'nib.exe', offset: '0x10' }] },
    {
      name: 'main',
      main: true,
      frames: [
        { module: 'ntdll.dll', offset: '0x9d4c4', symbol: 'NtWaitForSingleObject' },
        { module: 'nib.exe', offset: '0x1a2b3c' },
      ],
    },
  ],
  breadcrumbs: [{ at: Date.UTC(2026, 10, 5, 11, 59), what: 'opened a web tab' }],
  log: Array.from({ length: 100 }, (_, index) => `line ${index} with \`\`\` inside`),
}

describe('the issue a group becomes', () => {
  test('is named by its kind and title', () => {
    expect(tool.issueTitle(GROUP)).toBe('Freeze: 41 s in web_open, killed')
    expect(tool.issueTitle({ ...GROUP, kind: 'js', title: 'TypeError: x' })).toBe(
      'JS error: TypeError: x',
    )
  })

  test('counts, versions, the stuck thread first, crumbs and the end of the log, all fenced', () => {
    const body = tool.issueBody(GROUP, REPORT.id, REPORT)

    expect(body).toContain('**3 reports**')
    expect(body).toContain('Versions: 0.20.1, 0.20.2')
    expect(body).toContain('Platforms: Windows')
    expect(body).toContain('Held: 41.2 s')
    expect(body.indexOf('thread "main" (main)')).toBeLessThan(body.indexOf('thread "worker"'))
    expect(body).toContain('#00 ntdll.dll!NtWaitForSingleObject')
    expect(body).toContain('#01 nib.exe+0x1a2b3c')
    expect(body).toContain('opened a web tab')
    expect(body).toContain('line 99 with')
    expect(body).not.toContain('line 39 with')
    expect(body).toContain('````text\nline 40')
  })

  test('shows what the symbols say for our frames', () => {
    const symbols = new Map([
      [
        'nib.exe+0x1a2b3c',
        { symbol: 'nib_lib::web_tabs::open', location: 'src/web_tabs.rs:120:9' },
      ],
    ])
    expect(tool.issueBody(GROUP, REPORT.id, REPORT, symbols)).toContain(
      '#01 nib.exe+0x1a2b3c  nib_lib::web_tabs::open (src/web_tabs.rs:120:9)',
    )
  })
})

describe('symbolising', () => {
  test('asks only for our own frames that have no name yet', () => {
    expect([...tool.framesToSymbolize(REPORT, 'C:/build/nib.pdb').entries()]).toEqual([
      ['nib.exe+0x10', '0x10'],
      ['nib.exe+0x1a2b3c', '0x1a2b3c'],
    ])
  })

  test('reads what llvm-symbolizer says, unknowns too', () => {
    const output = [
      'nib_lib::web_tabs::open',
      'C:\\src\\web_tabs.rs:120:9',
      '',
      '??',
      '??:0:0',
      '',
      'core::panicking::panic',
      '??:0:0',
      '',
    ].join('\r\n')

    expect(tool.parseSymbolized(output)).toEqual([
      { symbol: 'nib_lib::web_tabs::open', location: 'C:\\src\\web_tabs.rs:120:9' },
      null,
      { symbol: 'core::panicking::panic', location: '' },
    ])
  })
})

describe('fences', () => {
  test('outgrow the backticks inside', () => {
    expect(tool.fenced('a ``` b')).toBe('````text\na ``` b\n````')
    expect(tool.fenced('plain')).toBe('```text\nplain\n```')
  })
})
