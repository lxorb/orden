import { describe, expect, test } from 'vitest'
import { chartFigure, chartSvg, readChart } from './chart'
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
    // Chart.js spells it one way and people type the other.
    expect(readChart('type: doughnut\nseries:\n  - data: [1]\n')?.kind).toBe('donut')
    expect(readChart('type: donut\nseries:\n  - data: [1]\n')?.kind).toBe('donut')
    // A kind nobody draws is not a reason to refuse the numbers.
    expect(readChart('type: radar\nseries:\n  - data: [1]\n')?.kind).toBe('bar')
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

describe('drawing it', () => {
  test('a bar per number, in the colours the tokens name', () => {
    const svg = chartSvg(readChart(SALES)!)
    expect(svg.match(/<rect class="chart-bar"/g)).toHaveLength(6)
    expect(svg).toContain('fill="var(--accent, #5b4be0)"')
    expect(svg).toContain('fill="var(--canvas-4, #08b94e)"')
    // The scale is drawn, and the labels along the bottom.
    expect(svg.match(/<line class="chart-grid"/g)).toHaveLength(4)
    expect(svg).toContain('>Jan<')
  })

  test('a line per series, with a dot per number', () => {
    const svg = chartSvg(readChart('type: line\nseries:\n  - data: [1, 4, 2]\n')!)
    expect(svg.match(/<polyline class="chart-line"/g)).toHaveLength(1)
    expect(svg.match(/<circle class="chart-dot"/g)).toHaveLength(3)
  })

  test('a slice per number, and a donut has a hole in it', () => {
    const pie = chartSvg(readChart('type: pie\nlabels: [a, b]\nseries:\n  - data: [1, 3]\n')!)
    expect(pie.match(/<path class="chart-slice"/g)).toHaveLength(2)
    // A pie's slices meet at the middle; a donut's do not.
    expect(pie).toContain('M 320,')
    const donut = chartSvg(readChart('type: donut\nseries:\n  - data: [1, 3]\n')!)
    expect(donut.match(/<path class="chart-slice"/g)).toHaveLength(2)
    expect(donut).not.toContain('M 320,150 L')
  })

  test('a single value fills the whole circle rather than drawing nothing', () => {
    // An arc from a point to the same point is drawn as no arc at all.
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
