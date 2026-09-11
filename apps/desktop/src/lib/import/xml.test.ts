import { describe, expect, test } from 'vitest'

import { element, elements, plainText, textOf, textsOf, unescapeXml } from './xml'

const ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20260101T090000Z">
  <note>
    <title>First &amp; last</title>
    <content><![CDATA[<en-note><div>One <b>bold</b> word</div></en-note>]]></content>
    <created>20260101T120000Z</created>
    <tag>work</tag>
    <tag>ideas</tag>
    <resource>
      <data encoding="base64">aGVsbG8=</data>
      <mime>image/png</mime>
      <resource-attributes><file-name>shot.png</file-name></resource-attributes>
    </resource>
  </note>
  <note>
    <title>Second</title>
    <content><![CDATA[<en-note>nothing much</en-note>]]></content>
  </note>
</en-export>`

describe('reading elements out of a document', () => {
  test('finds each record in order', () => {
    const notes = elements(ENEX, 'note')

    expect(notes).toHaveLength(2)
    expect(textOf(notes[0]?.inner ?? '', 'title')).toBe('First & last')
    expect(textOf(notes[1]?.inner ?? '', 'title')).toBe('Second')
  })

  test('hands back what is inside a CDATA section as markup', () => {
    const note = elements(ENEX, 'note')[0]?.inner ?? ''

    expect(textOf(note, 'content')).toBe('<en-note><div>One <b>bold</b> word</div></en-note>')
  })

  test('reads every element of the same name, and an attribute', () => {
    const note = elements(ENEX, 'note')[0]?.inner ?? ''

    expect(textsOf(note, 'tag')).toEqual(['work', 'ideas'])
    expect(element(note, 'data')?.attributes.encoding).toBe('base64')
  })

  test('nested elements of the same name are read as the outer one', () => {
    const xml = '<list><item>one<item>inner</item></item><item>two</item></list>'

    expect(elements(xml, 'item').map((one) => one.inner)).toEqual(['one<item>inner</item>', 'two'])
  })

  test('a tag that closes itself has nothing inside it', () => {
    const found = elements('<a><en-media hash="ab" /></a>', 'en-media')

    expect(found).toHaveLength(1)
    expect(found[0]?.inner).toBe('')
    expect(found[0]?.attributes.hash).toBe('ab')
  })

  test('a comment, a declaration and an instruction are not elements', () => {
    const xml = '<!-- <note>no</note> --><?x <note>no</note> ?><note>yes</note>'

    expect(textsOf(xml, 'note')).toEqual(['yes'])
  })

  test('a greater-than sign inside an attribute does not end the tag', () => {
    expect(element('<a title="1 > 0">x</a>', 'a')?.inner).toBe('x')
  })

  test('null for an element that is not there, and empty for one that is', () => {
    expect(textOf('<a></a>', 'b')).toBeNull()
    expect(textOf('<a></a>', 'a')).toBe('')
  })

  test('an element nothing closes reads to the end, rather than not at all', () => {
    expect(textOf('<note>half a note', 'note')).toBe('half a note')
  })
})

describe('entities', () => {
  test('resolves the ones XML defines and the numbers', () => {
    expect(unescapeXml('a &lt;b&gt; &amp; &quot;c&quot; &apos;d&apos;')).toBe(`a <b> & "c" 'd'`)
    expect(unescapeXml('&#65;&#x42;')).toBe('AB')
  })

  test('leaves one nothing knows exactly as written', () => {
    expect(unescapeXml('&lambda; &#x110000;')).toBe('&lambda; &#x110000;')
  })

  test('a field holding both CDATA and entities reads as words', () => {
    expect(plainText('one <![CDATA[& two]]> &amp; three')).toBe('one & two & three')
  })
})
