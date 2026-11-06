import { describe, expect, test } from 'vitest'
import { chartFigure, chartSvg, readChart, setChartLocale } from './chart'
import { renderMarkdown } from './index'

const SALES = `type: bar
title: Two quarters
labels: [Jan, Feb, Mar]
series:
  - title: Sales
    data: [3, 5, 2]
  - title: Costs
    data: [1, 2, 1]
`

describe('reading a chart out of a fence', () => {
  test('the plugin’s own shape', () => {
    expect(readChart(SALES)).toEqual({
      kind: 'bar',
      title: 'Two quarters',
      labels: ['Jan', 'Feb', 'Mar'],
      series: [
        { title: 'Sales', data: [3, 5, 2] },
        { title: 'Costs', data: [1, 2, 1] },
      ],
    })
  })

  test('a bar chart unless it says otherwise', () => {
    expect(readChart('series:\n  - data: [1, 2]\n')?.kind).toBe('bar')
    expect(readChart('type: line\nseries:\n  - data: [1]\n')?.kind).toBe('line')
    expect(readChart('type: pie\nseries:\n  - data: [1]\n')?.kind).toBe('pie')
    expect(readChart('type: doughnut\nseries:\n  - data: [1]\n')?.kind).toBe('donut')
    expect(readChart('type: donut\nseries:\n  - data: [1]\n')?.kind).toBe('donut')
    expect(readChart('type: scatter\nseries:\n  - data: [1]\n')?.kind).toBe('scatter')
    expect(readChart('type: radar\nseries:\n  - data: [1]\n')?.kind).toBe('radar')
    expect(readChart('type: polar\nseries:\n  - data: [1]\n')?.kind).toBe('polar')
    expect(readChart('type: polarArea\nseries:\n  - data: [1]\n')?.kind).toBe('polar')
  })

  test('and nothing at all for a kind nothing here draws', () => {
    expect(readChart('type: bubble\nseries:\n  - data: [1]\n')).toBeNull()
    expect(chartFigure('type: candlestick\nseries:\n  - data: [1]\n')).toBeNull()
  })

  test('quotes come off, and a key nobody knows is skipped', () => {
    const chart = readChart('title: "A count"\nstacked: true\nseries:\n  - data: [1]\n')
    expect(chart?.title).toBe('A count')
    expect(chart?.series).toEqual([{ title: '', data: [1] }])
  })

  test('one series written as a plain list', () => {
    expect(readChart('labels: [a, b]\nseries: [1, 2]\n')?.series).toEqual([
      { title: '', data: [1, 2] },
    ])
  })

  test('`label` is `title`, which is what the plugin also accepts', () => {
    expect(readChart('series:\n  - label: Sales\n    data: [1]\n')?.series[0]?.title).toBe('Sales')
  })

  test('block lists read as the flow lists they are', () => {
    const chart = readChart(
      'labels:\n  - a\n  - b\nseries:\n  - title: A\n    data:\n      - 1\n      - 2\n  - title: B\n    data:\n    - 3\n    - 4\n',
    )
    expect(chart?.labels).toEqual(['a', 'b'])
    expect(chart?.series).toEqual([
      { title: 'A', data: [1, 2] },
      { title: 'B', data: [3, 4] },
    ])
    expect(readChart('labels:\n- "a: b"\n- c\nseries: [1, 2]')?.labels).toEqual(['a: b', 'c'])
    expect(readChart('series:\n  - 1\n  - 2\n')?.series).toEqual([{ title: '', data: [1, 2] }])
  })

  test('a comment after a value is not part of it', () => {
    expect(readChart('series: [1, 2] # trailing')?.series[0]?.data).toEqual([1, 2])
    const chart = readChart('labels: [a, b] # note\ntitle: T # why\nseries:\n  - data: [1] # one\n')
    expect(chart?.labels).toEqual(['a', 'b'])
    expect(chart?.title).toBe('T')
    expect(chart?.series[0]?.data).toEqual([1])
  })

  test('refuses rather than draw zeroes for numbers it cannot read', () => {
    expect(readChart('type: scatter\nseries:\n  - data: [[1,2],[3,4]]\n')).toBeNull()
    expect(readChart('series:\n  - data: [{x: 1, y: 2}]\n')).toBeNull()
    expect(readChart('series:\n  - title: A\n    data:\n')).toBeNull()
  })

  test('a value that is not a number is a zero rather than a refusal', () => {
    expect(readChart('series:\n  - data: [1, x, 3]\n')?.series[0]?.data).toEqual([1, 0, 3])
  })

  test('and a fence with no numbers in it is not a chart', () => {
    expect(readChart('')).toBe(null)
    expect(readChart('type: bar\n')).toBe(null)
    expect(readChart('labels: [a, b]\n')).toBe(null)
    expect(readChart('series:\n  - title: Sales\n')).toBe(null)
    expect(readChart('<p>not yaml at all</p>')).toBe(null)
  })

  test('a comment is not data', () => {
    expect(readChart('# a note\nseries:\n  - data: [1]\n')?.series).toHaveLength(1)
  })
})

describe('a flow list over several lines', () => {
  test('reads as the one list it is', () => {
    const chart = readChart(
      'labels: [\n  a,\n  b\n]\nseries:\n  - title: s\n    data: [\n      1,\n      2\n    ]\n',
    )
    expect(chart?.labels).toEqual(['a', 'b'])
    expect(chart?.series[0]?.data).toEqual([1, 2])
    expect(readChart('data: [\n1,\n2\n]\n')).toBeNull()
    expect(readChart('series: [\n1,\n2\n]\n')?.series[0]?.data).toEqual([1, 2])
  })
})

describe('drawing it', () => {
  test('a bar per number, in the colours the tokens name', () => {
    const svg = chartSvg(readChart(SALES)!)
    expect(svg.match(/<rect class="chart-bar"/g)).toHaveLength(6)
    expect(svg).toContain('fill="var(--accent, #5b4be0)"')
    expect(svg).toContain('fill="var(--canvas-4, #08b94e)"')
    expect(svg).toContain('class="chart-grid"')
    expect(svg).toContain('>Jan<')
  })

  test('the scale lands on numbers somebody would have chosen', () => {
    const svg = chartSvg(readChart(SALES)!)
    for (const tick of ['>0<', '>2<', '>4<', '>6<']) expect(svg, tick).toContain(tick)
    expect(svg).not.toContain('3.33')

    const big = chartSvg(readChart('series:\n  - data: [1200, 3700]\n')!)
    for (const tick of ['>0<', '>1,000<', '>4,000<']) expect(big, tick).toContain(tick)

    const small = chartSvg(readChart('series:\n  - data: [0.2, 0.9]\n')!)
    expect(small).toContain('>1<')
  })

  test('and reaches below zero when the numbers do', () => {
    const svg = chartSvg(readChart('series:\n  - data: [-3, 4]\n')!)
    for (const tick of ['>-4<', '>-2<', '>0<', '>4<']) expect(svg, tick).toContain(tick)
  })

  test('a line per series, with a dot per number', () => {
    const svg = chartSvg(readChart('type: line\nseries:\n  - data: [1, 4, 2]\n')!)
    expect(svg.match(/<polyline class="chart-line"/g)).toHaveLength(1)
    expect(svg.match(/<circle class="chart-dot"/g)).toHaveLength(3)
  })

  test('a slice per number, and a donut has a hole in it', () => {
    const pie = chartSvg(readChart('type: pie\nlabels: [a, b]\nseries:\n  - data: [1, 3]\n')!)
    expect(pie.match(/<path class="chart-slice"/g)).toHaveLength(2)
    expect(pie).toContain('M 320,')
    const donut = chartSvg(readChart('type: donut\nseries:\n  - data: [1, 3]\n')!)
    expect(donut.match(/<path class="chart-slice"/g)).toHaveLength(2)
    expect(donut).not.toContain('M 320,150 L')
  })

  test('a single value fills the whole circle rather than drawing nothing', () => {
    const svg = chartSvg(readChart('type: pie\nseries:\n  - data: [7]\n')!)
    expect(svg.match(/<path class="chart-slice"/g)).toHaveLength(1)
    expect(svg).toContain('A ')
  })

  test('negative numbers hang below a baseline in the right place', () => {
    const svg = chartSvg(readChart('series:\n  - data: [-4, 4]\n')!)
    expect(svg).toContain('class="chart-axis"')
    expect(svg.match(/<rect class="chart-bar"/g)).toHaveLength(2)
  })

  test('a chart of nothing but zeroes still has a scale', () => {
    expect(() => chartSvg(readChart('series:\n  - data: [0, 0]\n')!)).not.toThrow()
  })

  test('every number is a hover title, so the picture is not the only reading', () => {
    expect(chartSvg(readChart(SALES)!)).toContain('<title>Sales: 5</title>')
  })

  test('scales with the column rather than asking for a width', () => {
    const svg = chartSvg(readChart(SALES)!)
    expect(svg).toContain('viewBox="0 0 640 340"')
    expect(svg).not.toContain('width="640"')
  })
})

describe('the block a fence becomes', () => {
  test('the picture, a legend and the title', () => {
    const figure = chartFigure(SALES) ?? ''
    expect(figure).toContain('<figure class="chart" data-kind="bar">')
    expect(figure).toContain('<figcaption>Two quarters</figcaption>')
    expect(figure).toContain('class="chart-key"')
    expect(figure).toContain('Sales')
  })

  test('and no legend when there is nothing to tell apart', () => {
    expect(chartFigure('series:\n  - title: Sales\n    data: [1]\n')).not.toContain('chart-keys')
  })

  test('a pie names its slices rather than its series', () => {
    const figure = chartFigure('type: pie\nlabels: [Bern, Zug]\nseries:\n  - data: [1, 2]\n') ?? ''
    expect(figure).toContain('Bern')
    expect(figure).toContain('Zug')
  })

  test('nothing a note wrote can end an attribute or open a tag', () => {
    const hostile = 'title: "</svg><script>alert(1)</script>"\nseries:\n  - data: [1]\n'
    const figure = chartFigure(hostile) ?? ''
    expect(figure).not.toContain('<script')
    expect(figure).not.toContain('</svg>a')
  })

  test('a label with a quote in it cannot break out of the text', () => {
    const figure = chartFigure('labels: ["a\\"><b"]\nseries:\n  - data: [1]\n') ?? ''
    expect(figure).not.toContain('><b<')
  })
})

describe('a chart in a note', () => {
  test('is drawn wherever a note is rendered, publishing included', () => {
    for (const escapeHtml of [false, true]) {
      const html = renderMarkdown('```chart\n' + SALES + '```\n', { escapeHtml })
      expect(html, String(escapeHtml)).toContain('<figure class="chart"')
      expect(html, String(escapeHtml)).not.toContain('<pre>')
    }
  })

  test('and a fence that is not a chart stays code', () => {
    const html = renderMarkdown('```chart\nnot a chart\n```\n')
    expect(html).toContain('<pre>')
    expect(html).toContain('not a chart')
  })

  test('a fence in another language is left alone', () => {
    expect(renderMarkdown('```yaml\ntype: bar\nseries:\n  - data: [1]\n```\n')).toContain('<pre>')
  })
})

describe('the language the numbers are written in', () => {
  const THOUSANDS = 'series:\n  - title: Sales\n    data: [1234.5, 2000]\n'

  test('English, where nobody has said otherwise', () => {
    const svg = chartSvg(readChart(THOUSANDS)!)
    expect(svg).toContain('<title>Sales: 1,234.5</title>')
    expect(svg).toContain('>1,000<')
  })

  test('and the one the caller names', () => {
    const svg = chartSvg(readChart(THOUSANDS)!, { locale: 'de' })
    expect(svg).toContain('<title>Sales: 1.234,5</title>')
    expect(svg).toContain('>1.000<')
  })

  test('through the block a fence becomes', () => {
    expect(chartFigure(THOUSANDS, { locale: 'de' })).toContain('1.234,5')
    expect(chartFigure(THOUSANDS)).toContain('1,234.5')
  })

  test('through a render option, which reaches a chart inside the note', () => {
    const fence = '```chart\n' + THOUSANDS + '```\n'
    expect(renderMarkdown(fence, { locale: 'de' })).toContain('1.234,5')
    expect(renderMarkdown(fence, { locale: 'en-US' })).toContain('1,234.5')
    expect(renderMarkdown(fence, { locale: 'de', escapeHtml: true, toc: true })).toContain(
      '1.234,5',
    )
  })

  test('or once, for every caller that names none', () => {
    try {
      setChartLocale('de')
      expect(chartFigure(THOUSANDS)).toContain('1.234,5')
      expect(chartFigure(THOUSANDS, { locale: 'en-US' })).toContain('1,234.5')
    } finally {
      setChartLocale('')
    }
  })

  test('and English again when what it is handed is nothing', () => {
    setChartLocale('')
    expect(chartFigure(THOUSANDS)).toContain('1,234.5')
  })
})

describe('the kinds that were drawn as a bar chart', () => {
  const THREE = 'labels: [a, b, c]\nseries:\n  - title: One\n    data: [3, 1, 2]\n'

  test('a radar draws its web, its spokes and a shape per series', () => {
    const svg = chartSvg(readChart(`type: radar\n${THREE}`)!)

    expect(svg).toContain('<polygon class="chart-grid"')
    expect(svg).toContain('<polygon class="chart-area"')
    expect(svg.match(/class="chart-label"/g)?.length).toBe(3)
    expect(svg).not.toContain('<line class="chart-grid" x1="48"')
  })

  test('a radar of two series draws both, in two colours', () => {
    const two = `type: radar\nlabels: [a, b]\nseries:\n  - data: [1, 2]\n  - data: [2, 1]\n`
    const svg = chartSvg(readChart(two)!)

    expect(svg.match(/class="chart-area"/g)?.length).toBe(2)
  })

  test('a polar area draws a slice per number, each reaching as far as it says', () => {
    const svg = chartSvg(readChart(`type: polar\n${THREE}`)!)

    expect(svg.match(/class="chart-slice"/g)?.length).toBe(3)
    expect(svg).not.toContain('<polygon')
  })

  test('a scatter draws the points and no line through them', () => {
    const svg = chartSvg(readChart(`type: scatter\n${THREE}`)!)

    expect(svg.match(/class="chart-dot"/g)?.length).toBe(3)
    expect(svg).not.toContain('chart-line')
    expect(svg).toContain('class="chart-grid"')
  })

  test('a line still draws its line, which is the whole difference', () => {
    expect(chartSvg(readChart(`type: line\n${THREE}`)!)).toContain('chart-line')
  })

  test('and every one of them is the kind the figure says it is', () => {
    for (const kind of ['radar', 'polar', 'scatter']) {
      expect(chartFigure(`type: ${kind}\n${THREE}`), kind).toContain(`data-kind="${kind}"`)
    }
  })
})

describe('a kind an object would answer from its prototype', () => {
  test('is a kind nothing knows, and the fence keeps its characters', () => {
    for (const kind of ['constructor', '__proto__', 'toString']) {
      expect(readChart(`type: ${kind}\nlabels: [a]\nseries:\n  - data: [1]\n`)).toBeNull()
    }
  })
})

describe('numbers at the ends of what a number can be', () => {
  const DATA = [
    '0, 0',
    '1e308',
    '1.7e308, 1.7e308',
    '1e308, -1e308',
    '-1.7e308, 1',
    '1e308, 1, -5',
    '1.7976931348623157e308',
    '-1.7976931348623157e308',
    '1.7976931348623157e308, -1.7976931348623157e308',
    '-1.7e308',
    '1e300, 1e-300',
    '5e-324',
    '-5e-324',
    '5e-324, 1e-323',
    '1e-320',
  ]
  const KINDS = ['bar', 'line', 'scatter', 'pie', 'donut', 'radar', 'polar']

  test.each(KINDS.flatMap((kind) => DATA.map((data) => [kind, data] as const)))(
    '%s of [%s] holds nothing but numbers',
    (kind, data) => {
      const figure = chartFigure(`type: ${kind}\nseries:\n  - data: [${data}]\n`)
      expect(figure).toMatch(/<svg/)
      expect(figure).not.toMatch(/NaN|Infinity|∞/)
    },
  )

  test('a value is said as what it is, not as infinity', () => {
    const svg = chartSvg(readChart('series:\n  - data: [1e307]\n')!)
    expect(svg).toMatch(/<title>10(,000)+<\/title>/)
    expect(svg).not.toMatch(/<title>∞/)
  })

  test('the scale stops where numbers stop, and its lines stay on the step', () => {
    const svg = chartSvg(readChart('series:\n  - data: [1.7e308, -1.7e308]\n')!)
    const ticks = [...svg.matchAll(/class="chart-tick"[^>]*>([^<]+)</g)].map((one) => one[1])
    expect(ticks).toContain('0')
    expect(ticks.some((one) => one?.startsWith('100,000,000'))).toBe(true)
    expect(ticks.some((one) => one?.startsWith('-100,000,000'))).toBe(true)
    for (const y of svg.matchAll(/class="chart-grid"[^>]* y1="([^"]+)"/g)) {
      expect(Number(y[1])).toBeGreaterThanOrEqual(24)
      expect(Number(y[1])).toBeLessThanOrEqual(300)
    }
  })

  test('a radar at the edge keeps its rings inside the rim', () => {
    const svg = chartSvg(readChart('type: radar\nseries:\n  - data: [1.7e308, 1, 1]\n')!)
    expect(svg).not.toMatch(/NaN|Infinity/)
    const rim = 146
    for (const ring of svg.matchAll(/<polygon class="chart-grid" points="([^"]+)"/g)) {
      for (const point of (ring[1] ?? '').split(' ')) {
        const [x = 0, y = 0] = point.split(',').map(Number)
        expect(Math.hypot(x - 320, y - 162)).toBeLessThanOrEqual(rim + 1)
      }
    }
  })

  test('a number that rounds to nothing is no negative zero', () => {
    for (const data of ['-0, 5', '-0.004, 5']) {
      const svg = chartSvg(readChart(`series:\n  - data: [${data}]\n`)!)
      expect(svg).toContain('<title>0</title>')
      expect(svg).not.toContain('-0<')
    }
  })

  test('a pie too big to add up is still a pie', () => {
    const svg = chartSvg(readChart('type: pie\nseries:\n  - data: [1.7e308, 1.7e308]\n')!)
    expect(svg.match(/class="chart-slice"/g)).toHaveLength(2)
  })

  test('zeroes draw against the same scale they always asked for', () => {
    const svg = chartSvg(readChart('series:\n  - data: [0, 0]\n')!)
    expect(svg.match(/class="chart-grid"/g)).toHaveLength(5)
  })
})

describe('what a comment is not', () => {
  test('a hash inside a list', () => {
    expect(readChart('labels: [#1, #2]\nseries: [1, 2]')?.labels).toEqual(['#1', '#2'])
    expect(readChart('labels: [a #1, b #2] # note\nseries: [1, 2]')?.labels).toEqual([
      'a #1',
      'b #2',
    ])
    expect(readChart('series: [1, 2] # [3]')?.series[0]?.data).toEqual([1, 2])
  })

  test('a title that begins with one', () => {
    expect(readChart('title: #1 Sales\nseries: [1]')?.title).toBe('#1 Sales')
    expect(readChart('title: Issue #12\nseries: [1]')?.title).toBe('Issue')
  })

  test('a key whose list is below it still opens with a comment beside it', () => {
    const chart = readChart(
      'labels: # the months\n  - a\nseries: # all\n  - data: # one\n      - 1\n',
    )
    expect(chart?.labels).toEqual(['a'])
    expect(chart?.series[0]?.data).toEqual([1])
  })
})
