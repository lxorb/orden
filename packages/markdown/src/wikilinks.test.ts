import { describe, expect, test } from 'vitest'
import type { Wikilink } from './links'
import { renderMarkdown } from './index'

const NOTES: Record<string, string> = {
  plan: '/notes/plan',
  spark: '/notes/spark',
  'paper.pdf': '/i/abc.pdf',
  intro: 'C#/Intro.md',
  're: lunch': 'Re: lunch.md',
}
const resolveLink = (link: Wikilink) => {
  const href = NOTES[link.target.toLowerCase()]
  return href === undefined ? null : { href }
}
const BODIES: Record<string, string> = {
  plan: '# The plan\n\nFirst part.\n\n## Later\n\nSecond part.\n',
  spark: 'A single idea. ^abc123\n\nAnother paragraph.\n',
}
const resolveEmbed = (link: Wikilink) => BODIES[link.target.toLowerCase()] ?? null
describe('a wikilink on a page', () => {
  test('is an anchor when the caller can resolve it; names a path holding # or : as a path, not as a fragment or a scheme', () => {
    expect(renderMarkdown('see [[Plan]] now', { resolveLink })).toContain(
      '<a class="wikilink" href="/notes/plan">Plan</a>',
    )
    expect(renderMarkdown('[[Intro#Start]]', { resolveLink })).toContain('href="C%23/Intro.md#start"')
    expect(renderMarkdown('[[Re: lunch]]', { resolveLink })).toContain(
      '<a class="wikilink" href="Re%3a%20lunch.md">Re: lunch</a>',
    )
  })
  test('shows its alias rather than the target; points at the heading it names, by the id the renderer gives it; carries a PDF page as the fragment a PDF viewer reads', () => {
    expect(renderMarkdown('[[Plan|the plan]]', { resolveLink })).toContain(
      '<a class="wikilink" href="/notes/plan">the plan</a>',
    )
    expect(renderMarkdown('[[Plan#Some Heading]]', { resolveLink })).toContain('href="/notes/plan#some-heading"')
    expect(renderMarkdown('[[paper.pdf#page=3]]', { resolveLink })).toContain(
      '<a class="wikilink" href="/i/abc.pdf#page=3">paper.pdf#page=3</a>',
    )
  })
  test('is plain text when nothing answers to the name', () => {
    const html = renderMarkdown('see [[Nowhere]] now', { resolveLink })
    expect(html).toContain('see Nowhere now')
    expect(html).not.toContain('<a')
  })
  test('is plain text when there is no resolver at all, as in an export; is not read inside code', () => {
    const html = renderMarkdown('see [[Plan|the plan]] now')
    expect(html).toContain('see the plan now')
    expect(html).not.toContain('<a')
    expect(renderMarkdown('`[[Plan]]`', { resolveLink })).toContain('<code>[[Plan]]</code>')
    expect(renderMarkdown('```\n[[Plan]]\n```', { resolveLink })).not.toContain('<a')
  })
  test('an escaped bracket is words', () => {
    const html = renderMarkdown('\\[[Plan]]', { resolveLink })
    expect(html).not.toContain('<a')
    expect(html).toContain('[[Plan]]')
  })
  test('is not wrapped in a markdown link as well', () => {
    const html = renderMarkdown('[[Plan]]', { resolveLink })
    expect(html.match(/<a/g)).toHaveLength(1)
  })
})
describe('what a wikilink cannot do to the page', () => {
  test('a target that names a script scheme leaves no anchor', () => {
    const html = renderMarkdown('[[x]]', {
      resolveLink: () => ({ href: 'javascript:alert(1)' }),
    })
    expect(html).not.toContain('javascript')
    expect(html).toContain('x')
  })
  test('a quote in a resolved target cannot end the attribute', () => {
    const html = renderMarkdown('[[x]]', {
      resolveLink: () => ({ href: '/notes/a"onmouseover="alert(1)' }),
    })
    expect(html).not.toContain('onmouseover="alert(1)"')
    expect(html).toContain('href="/notes/a%22onmouseover=%22alert(1)"')
  })
  test('an entity in a resolved target cannot grow into a scheme', () => {
    const html = renderMarkdown('[[x]]', {
      resolveLink: () => ({ href: 'javascript&colon;alert(1)' }),
    })
    expect(html).toContain('href="javascript&amp;colon;alert(1)"')
    expect(html).not.toContain('javascript&colon;alert(1)"')
  })
  test('tags in the words a link shows are escaped', () => {
    const html = renderMarkdown('[[Plan|<img src=x onerror=alert(1)>]]', { resolveLink })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
  test('tags in a name the caller hands back are escaped', () => {
    const html = renderMarkdown('[[Plan]]', {
      resolveLink: () => ({ href: '/a', text: '<script>alert(1)</script>' }),
    })
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script')
  })
  test('tags in an embedded note are escaped when the page escapes HTML', () => {
    const html = renderMarkdown('![[bad]]', {
      escapeHtml: true,
      resolveEmbed: () => '<img src=x onerror=alert(1)>',
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
  test('an embed of a note whose name carries a tag is escaped in the caption', () => {
    const html = renderMarkdown('![[plan|<b>x</b>]]', { resolveEmbed })
    expect(html).toContain('<figcaption>&lt;b&gt;x&lt;/b&gt;</figcaption>')
  })
  test('a note cannot write the marker an embed is put in place of', () => {
    const html = renderMarkdown('<!--orden:embed:0-->\n\n![[plan]]', { resolveEmbed })
    expect(html).not.toContain('orden:embed:0')
    expect(html).toContain('The plan')
  })
})
describe('an embed on a page', () => {
  test('renders the note inside a frame with its name under it', () => {
    const html = renderMarkdown('![[plan]]', { resolveEmbed })
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('<h1>The plan</h1>')
    expect(html).toContain('First part.')
    expect(html).toContain('<figcaption>plan</figcaption>')
  })
  test('a heading names the section, and only that section', () => {
    const html = renderMarkdown('![[plan#Later]]', { resolveEmbed })
    expect(html).toContain('Second part.')
    expect(html).not.toContain('First part.')
  })
  test('a block names the paragraph, without the marker itself', () => {
    const html = renderMarkdown('![[spark#^abc123]]', { resolveEmbed })
    expect(html).toContain('<p>A single idea.</p>')
    expect(html).not.toContain('idea. ^abc123')
    expect(html).toContain('<figcaption>spark#^abc123</figcaption>')
    expect(html).not.toContain('Another paragraph.')
  })
  test('an embed with words beside it is a link, not a frame in a paragraph; a frame is never left inside a paragraph', () => {
    const html = renderMarkdown('see ![[plan]] now', { resolveEmbed, resolveLink })
    expect(html).not.toContain('<figure')
    expect(html).toContain('see')
    expect(renderMarkdown('![[plan]]', { resolveEmbed })).not.toContain('<p><figure')
  })
  test('a heading the note has not got is a link rather than an empty frame', () => {
    const html = renderMarkdown('![[plan#Nowhere]]', { resolveEmbed, resolveLink })
    expect(html).not.toContain('<figure')
    expect(html).toContain('plan#Nowhere')
  })
  test('a note the space has not got is a link; an embed is a link when nothing can resolve one, as in a plain export', () => {
    const html = renderMarkdown('![[Nothing]]', { resolveEmbed, resolveLink })
    expect(html).not.toContain('<figure')
    expect(renderMarkdown('![[plan]]')).toContain('plan')
    expect(renderMarkdown('![[plan]]')).not.toContain('<figure')
  })
  test('one level deep: an embed inside an embed is a link', () => {
    const bodies: Record<string, string> = {
      outer: 'Outer says: ![[inner]]\n',
      inner: 'Inner text.\n',
    }
    const html = renderMarkdown('![[outer]]', {
      resolveEmbed: (link) => bodies[link.target] ?? null,
    })
    expect(html).toContain('Outer says:')
    expect(html).not.toContain('Inner text.')
    expect(html.match(/<figure/g)).toHaveLength(1)
  })
  test('a note that embeds itself renders once and stops', () => {
    const html = renderMarkdown('![[self]]', {
      resolveEmbed: () => 'Round and round ![[self]]\n',
    })
    expect(html.match(/Round and round/g)).toHaveLength(1)
    expect(html.match(/<figure/g)).toHaveLength(1)
  })
  test('links inside an embedded note still resolve', () => {
    const html = renderMarkdown('![[plan]]', {
      resolveEmbed: () => 'see [[Spark]]\n',
      resolveLink,
    })
    expect(html).toContain('href="/notes/spark"')
  })
  test('several embeds each get their own note', () => {
    const html = renderMarkdown('![[plan]]\n\n![[spark]]', { resolveEmbed })
    expect(html).toContain('The plan')
    expect(html).toContain('A single idea.')
    expect(html.match(/<figure/g)).toHaveLength(2)
  })
  test('a picture named as an embed is a picture', () => {
    const html = renderMarkdown('![[shot.png]]', { resolveEmbed, resolveLink })
    expect(html).toContain('<img src="shot.png" alt="">')
    expect(html).not.toContain('<figure')
  })
})
describe('a file embedded in a note', () => {
  test('a recording is a player, and nothing plays on its own; a film is a player too; a container either can be in is read as what it usually holds', () => {
    const html = renderMarkdown('![[clip.mp3]]\n')
    expect(html).toContain('<audio class="embed-media" controls preload="metadata"')
    expect(html).toContain('src="clip.mp3"')
    expect(html).not.toContain('autoplay')
    for (const name of ['demo.mp4', 'demo.webm', 'demo.mov']) {
      expect(renderMarkdown(`![[${name}]]\n`), name).toContain(`<video class="embed-media"`)
    }
    expect(renderMarkdown('![[a.webm]]\n')).toContain('<video')
    expect(renderMarkdown('![[a.weba]]\n')).toContain('<audio')
  })
  test('a player is what it is inside a sentence as well; a size after the bar is how wide to draw it; anything else after the bar says what it is', () => {
    const html = renderMarkdown('before ![[clip.mp3]] after\n')
    expect(html).toContain('<audio')
    expect(html).toContain('before ')
    expect(html).toContain(' after')
    expect(renderMarkdown('![[shot.png|300]]\n')).toContain('width="300"')
    expect(renderMarkdown('![[shot.png|300x200]]\n')).toContain('width="300" height="200"')
    expect(renderMarkdown('![[demo.mp4|480]]\n')).toContain('width="480"')
    expect(renderMarkdown('![[shot.png|the sketch]]\n')).toContain('alt="the sketch"')
    expect(renderMarkdown('![[clip.mp3|the take]]\n')).toContain('title="the take"')
  })
  test('a paper is a card that opens it, with the page the link asked for', () => {
    const html = renderMarkdown('![[paper.pdf#page=3]]\n', { resolveLink })
    expect(html).toContain('<figure class="embed embed-file" data-kind="pdf"')
    expect(html).toContain('href="/i/abc.pdf#page=3"')
    expect(html).toContain('paper.pdf#page=3')
    expect(html).toContain('<svg')
  })
  test('and says which page of which file a surface should draw in it; a paper whose link names no page carries none', () => {
    const html = renderMarkdown('![[paper.pdf#page=3]]\n', { resolveLink })
    expect(html).toContain('data-file="paper.pdf"')
    expect(html).toContain('data-page="3"')
    expect(renderMarkdown('![[paper.pdf]]\n', { resolveLink })).not.toContain('data-page')
  })
  test('a plane is a card as well', () => {
    const html = renderMarkdown('![[board.canvas]]\n')
    expect(html).toContain('data-kind="canvas"')
    expect(html).toContain('board.canvas')
  })
  test('and names the file to draw, with no page, since a plane has none', () => {
    const html = renderMarkdown('![[board.canvas]]\n')
    expect(html).toContain('data-file="board.canvas"')
    expect(html).not.toContain('data-page=')
  })
  test('a file name cannot end the attribute the card names it in', () => {
    const html = renderMarkdown('![[a" onerror="alert(1).pdf]]\n')
    expect(html).not.toContain('onerror="alert(1)"')
  })
  test('a card nobody can open is still the name of the file; a card is never left inside a paragraph; a file is never read as a note', () => {
    const html = renderMarkdown('![[missing.pdf]]\n')
    expect(html).toContain('missing.pdf')
    expect(html).not.toContain('<a')
    expect(renderMarkdown('![[paper.pdf]]\n')).not.toContain('<p><figure')
    const every = () => '# Something else'
    for (const name of ['a.png', 'a.mp3', 'a.mp4', 'a.pdf', 'a.canvas']) {
      expect(renderMarkdown(`![[${name}]]\n`, { resolveEmbed: every }), name).not.toContain('Something else')
    }
  })
  test('a target that could not go into an attribute is not written into one', () => {
    const html = renderMarkdown('![[javascript:alert(1)//x.mp3]]\n')
    expect(html).not.toContain('<audio')
    expect(html).not.toContain('src=')
  })
  test('a name with a quote in it cannot end the attribute it is written in', () => {
    const html = renderMarkdown('![[a" onerror="alert(1).mp4]]\n')
    expect(html).not.toContain('onerror="alert(1)"')
  })
})
describe('a picture a page shows', () => {
  const asked: [string, boolean, string | null][] = []
  const resolvePicture = (src: string, wikilink: boolean, from: { path?: string } | null) => {
    asked.push([src, wikilink, from?.path ?? null])
    return `found/${src}`
  }
  test('is looked up knowing whether a wikilink or a markdown link named it', () => {
    asked.length = 0
    const html = renderMarkdown('![[shot.png]]\n\n![](pic.png)\n', { resolvePicture })
    expect(asked).toEqual([
      ['shot.png', true, null],
      ['pic.png', false, null],
    ])
    expect(html).toContain('<img src="found/shot.png"')
    expect(html).toContain('<img src="found/pic.png"')
  })
  test('inside an embedded note is looked up from that note', () => {
    asked.length = 0
    renderMarkdown('![[Plan]]\n', {
      resolvePicture,
      resolveEmbed: () => ({
        text: '![](../../assets/abc.png)\n',
        escapeHtml: false,
        path: '/Work/Projects/Q1/Plan.md',
      }),
    })
    expect(asked).toEqual([['../../assets/abc.png', false, '/Work/Projects/Q1/Plan.md']])
  })
})
describe('a link inside an embedded note', () => {
  const plan = {
    text: 'see [[Budget]] and [b](Budget.md)\n',
    escapeHtml: false,
    path: '/W/Q1/Plan.md',
  }
  test('is resolved from the note it was written in', () => {
    const asked: (string | null)[] = []
    const html = renderMarkdown('[[Budget]]\n\n![[Plan]]\n', {
      resolveEmbed: () => plan,
      resolveLink: (link, from) => {
        asked.push(from?.path ?? null)
        return { href: from ? `Q1/${link.target}.md` : `${link.target}.md` }
      },
      resolveNoteFrom: (target, from) => (from.path === plan.path ? `Q1/${target}` : null),
    })
    expect(asked).toEqual([null, '/W/Q1/Plan.md'])
    expect(html).toContain('<a class="wikilink" href="Budget.md">Budget</a>')
    expect(html).toContain('<a class="wikilink" href="Q1/Budget.md">Budget</a>')
    expect(html).toContain('<a class="wikilink" href="Q1/Budget.md">b</a>')
  })
  test('without an ending, or with a title, is resolved from that note too', () => {
    const html = renderMarkdown('![[Plan]]\n', {
      resolveEmbed: () => ({ ...plan, text: '[b](Budget "tip") and [v](<Version 2.0>)\n' }),
      resolveNoteFrom: (target) => `Q1/${decodeURI(target)}.md`,
    })
    expect(html).toContain('<a class="wikilink" href="Q1/Budget.md" title="tip">b</a>')
    expect(html).toContain('<a class="wikilink" href="Q1/Version%202.0.md">v</a>')
  })
  test('to nothing that note can reach stays the link it was', () => {
    const html = renderMarkdown('![[Plan]]\n', {
      resolveEmbed: () => plan,
      resolveNoteFrom: () => null,
    })
    expect(html).toContain('<a href="Budget.md">b</a>')
  })
})
describe('footnotes inside an embedded note', () => {
  test('have ids of their own, and are gathered once', () => {
    const html = renderMarkdown('Host says[^1].\n\n![[E]]\n\n[^1]: Host note.\n', {
      footnotes: true,
      resolveEmbed: () => 'Embed says[^1].\n\n[^1]: Embed note.\n',
    })
    expect(html.match(/id="fn-1"/g)).toHaveLength(1)
    expect(html.match(/id="fnref-1"/g)).toHaveLength(1)
    expect(html).toContain('<li id="e0-fn-1"><a class="footnote-back" href="#e0-fnref-1">')
    expect(html).not.toContain('<section class="footnotes"><ol><section class="footnotes">')
  })
  test('leave a link to a note named like a footnote as it was', () => {
    const html = renderMarkdown('![[E]]\n', {
      footnotes: true,
      resolveEmbed: () => 'See [[fn-plan]] and [m](fnref-x.md).\n',
      resolveLink: (link) => ({ href: `${link.target}.md` }),
    })
    expect(html).toContain('href="fn-plan.md"')
    expect(html).toContain('href="fnref-x.md"')
  })
})
describe('a cover', () => {
  test('is looked up as the note names it', () => {
    const html = renderMarkdown('---\ncover: photo.png\n---\n\nWords\n', {
      cover: true,
      resolvePicture: (src) => `../attachments/${src}`,
    })
    expect(html).toContain('<img src="../attachments/photo.png"')
  })
})
