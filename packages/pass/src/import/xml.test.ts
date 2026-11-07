import { describe, expect, it } from 'vitest'
import { decodeEntities, parseXml, textAt } from './xml'

describe('parseXml', () => {
  it('reads elements, attributes, text, CDATA and entities', () => {
    const root = parseXml(
      '﻿<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE x>\n<!-- note -->' +
        '<a k="1 &amp; 2" j=\'q\'><b>x &lt;y&gt; &#65;&#x42; &quot;&apos;</b><c/><d><![CDATA[<raw> & ]]></d></a>',
    )
    expect(root.name).toBe('a')
    expect(root.attributes).toEqual({ k: '1 & 2', j: 'q' })
    expect(textAt(root, 'b')).toBe('x <y> AB "\'')
    expect(root.children.map((one) => one.name)).toEqual(['b', 'c', 'd'])
    expect(textAt(root, 'd')).toBe('<raw> & ')
    expect(textAt(root, 'missing', 'deeper')).toBe('')
  })

  it('refuses what is not well-formed', () => {
    expect(() => parseXml('<a><b></a>')).toThrow()
    expect(() => parseXml('<a>')).toThrow()
    expect(() => parseXml('<a/><b/>')).toThrow()
    expect(() => parseXml('plain')).toThrow()
  })

  it('leaves unknown entities as they are', () => {
    expect(decodeEntities('&nbsp; &#xZZ; &amp;')).toBe('&nbsp; &#xZZ; &')
  })
})
