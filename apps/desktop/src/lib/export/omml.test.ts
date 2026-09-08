import { Document, Math as Maths, Packer, Paragraph } from 'docx'
import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'
import { ommlFor } from './omml'

/** The OMML a formula comes to, as the XML Word will read.
 *
 *  A tree of `docx` components cannot be looked at from the outside, so the only
 *  honest way to see what was built is to build the document and open it again. */
async function ommlOf(tex: string): Promise<string> {
  const children = ommlFor(tex)
  expect(children, tex).not.toBeNull()

  // Asserted not null on the line above.
  const file = new Document({
    sections: [{ children: [new Paragraph({ children: [new Maths({ children: children! })] })] }],
  })

  const zip = await JSZip.loadAsync(await Packer.toBase64String(file), { base64: true })
  const xml = await zip.file('word/document.xml')!.async('string')

  return xml.slice(xml.indexOf('<m:oMath'), xml.indexOf('</m:oMath>') + '</m:oMath>'.length)
}

const GREEK =
  '\\alpha \\beta \\gamma \\delta \\epsilon \\zeta \\eta \\theta \\iota \\kappa \\lambda \\mu ' +
  '\\nu \\xi \\omicron \\pi \\rho \\sigma \\tau \\upsilon \\phi \\chi \\psi \\omega ' +
  '\\Alpha \\Beta \\Gamma \\Delta \\Epsilon \\Zeta \\Eta \\Theta \\Iota \\Kappa \\Lambda \\Mu ' +
  '\\Nu \\Xi \\Omicron \\Pi \\Rho \\Sigma \\Tau \\Upsilon \\Phi \\Chi \\Psi \\Omega'

const OPERATORS: [string, string][] = [
  ['\\times', '×'],
  ['\\cdot', '⋅'],
  ['\\div', '÷'],
  ['\\pm', '±'],
  ['\\mp', '∓'],
  ['\\leq', '≤'],
  ['\\geq', '≥'],
  ['\\neq', '≠'],
  ['\\approx', '≈'],
  ['\\equiv', '≡'],
  ['\\to', '→'],
  ['\\rightarrow', '→'],
  ['\\leftarrow', '←'],
  ['\\infty', '∞'],
  ['\\partial', '∂'],
  ['\\nabla', '∇'],
  ['\\prod', '∏'],
  ['\\in', '∈'],
  ['\\notin', '∉'],
  ['\\subset', '⊂'],
  ['\\cup', '∪'],
  ['\\cap', '∩'],
  ['\\forall', '∀'],
  ['\\exists', '∃'],
  ['\\therefore', '∴'],
  ['\\deg', '°'],
  ['\\circ', '∘'],
  ['\\ldots', '…'],
  ['\\cdots', '⋯'],
]

describe('a formula Word can lay out', () => {
  test('runs plain characters together', async () => {
    expect(await ommlOf('E=mc')).toBe('<m:oMath><m:r><m:t>E=mc</m:t></m:r></m:oMath>')
  })

  test('raises a superscript off the one character before it', async () => {
    const xml = await ommlOf('E=mc^2')

    expect(xml).toContain('<m:r><m:t>E=m</m:t></m:r>')
    expect(xml).toContain('<m:sSup>')
    expect(xml).toContain('<m:e><m:r><m:t>c</m:t></m:r></m:e>')
    expect(xml).toContain('<m:sup><m:r><m:t>2</m:t></m:r></m:sup>')
  })

  test('lowers a subscript', async () => {
    const xml = await ommlOf('x_i')

    expect(xml).toContain('<m:sSub>')
    expect(xml).toContain('<m:sub><m:r><m:t>i</m:t></m:r></m:sub>')
  })

  test('stacks a subscript and a superscript on the same base', async () => {
    const xml = await ommlOf('x_i^2')

    expect(xml).toContain('<m:sSubSup>')
    expect(xml).toContain('<m:sub><m:r><m:t>i</m:t></m:r></m:sub>')
    expect(xml).toContain('<m:sup><m:r><m:t>2</m:t></m:r></m:sup>')
    expect(xml).not.toContain('<m:sSup>')
  })

  test('takes a braced group as one base', async () => {
    const xml = await ommlOf('{ab}^2')

    expect(xml).toContain('<m:sSup>')
    expect(xml).toContain('<m:e><m:r><m:t>ab</m:t></m:r></m:e>')
  })

  test('writes a fraction as a numerator over a denominator', async () => {
    for (const macro of ['\\frac', '\\dfrac', '\\tfrac']) {
      const xml = await ommlOf(`${macro}{a}{b}`)

      expect(xml, macro).toContain('<m:f>')
      expect(xml, macro).toContain('<m:num><m:r><m:t>a</m:t></m:r></m:num>')
      expect(xml, macro).toContain('<m:den><m:r><m:t>b</m:t></m:r></m:den>')
    }
  })

  test('takes the single character after a fraction that has no braces', async () => {
    const xml = await ommlOf('\\frac12')

    expect(xml).toContain('<m:num><m:r><m:t>1</m:t></m:r></m:num>')
    expect(xml).toContain('<m:den><m:r><m:t>2</m:t></m:r></m:den>')
  })

  test('writes a square root with its degree hidden', async () => {
    const xml = await ommlOf('\\sqrt{2}')

    expect(xml).toContain('<m:rad>')
    expect(xml).toContain('<m:degHide m:val="1"/>')
    expect(xml).toContain('<m:e><m:r><m:t>2</m:t></m:r></m:e>')
  })

  test('writes an nth root with the degree it was given', async () => {
    const xml = await ommlOf('\\sqrt[3]{x}')

    expect(xml).toContain('<m:rad>')
    expect(xml).toContain('<m:deg><m:r><m:t>3</m:t></m:r></m:deg>')
    expect(xml).not.toContain('<m:degHide')
  })

  test('writes a sum as an n-ary carrying the sum sign', async () => {
    const xml = await ommlOf('\\sum_{i=1}^{n} i')

    expect(xml).toContain('<m:nary>')
    expect(xml).toContain('<m:chr m:val="∑"/>')
    expect(xml).toContain('<m:sub><m:r><m:t>i=1</m:t></m:r></m:sub>')
    expect(xml).toContain('<m:sup><m:r><m:t>n</m:t></m:r></m:sup>')
    // What the sum runs over is everything written after it, which is what TeX
    // means by writing them side by side.
    expect(xml).toContain('<m:e><m:r><m:t>i</m:t></m:r></m:e>')
  })

  test('writes an integral with its limits beside the sign', async () => {
    const xml = await ommlOf('\\int_0^1 x\\,dx')

    expect(xml).toContain('<m:nary>')
    // The integral sign is OMML's own default for an n-ary, so there is no
    // `m:chr` to write; what says it is an integral is where the limits sit.
    expect(xml).toContain('<m:limLoc m:val="subSup"/>')
    expect(xml).toContain('<m:sub><m:r><m:t>0</m:t></m:r></m:sub>')
    expect(xml).toContain('<m:sup><m:r><m:t>1</m:t></m:r></m:sup>')
    expect(xml).toContain('<m:t>dx</m:t>')
  })

  test('brackets a group however the brackets were written', async () => {
    for (const tex of ['(x+1)', '\\left(x+1\\right)']) {
      const xml = await ommlOf(tex)

      expect(xml, tex).toContain('<m:d><m:dPr/>')
      expect(xml, tex).toContain('<m:t>x+1</m:t>')
    }

    expect(await ommlOf('[x]')).toContain('<m:begChr m:val="["/><m:endChr m:val="]"/>')
    expect(await ommlOf('\\{x\\}')).toContain('<m:begChr m:val="{"/><m:endChr m:val="}"/>')
    expect(await ommlOf('\\left[x\\right]')).toContain('<m:begChr m:val="["/>')
  })

  test('sets a named function upright', async () => {
    for (const name of ['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'max', 'min']) {
      const xml = await ommlOf(`\\${name} x`)

      expect(xml, name).toContain('<m:func>')
      expect(xml, name).toContain(`<m:fName><m:r><m:t>${name}</m:t></m:r></m:fName>`)
      expect(xml, name).toContain('<m:e><m:r><m:t>x</m:t></m:r></m:e>')
    }
  })

  test('knows the Greek alphabet in both cases', async () => {
    const xml = await ommlOf(GREEK)

    for (const character of ['α', 'θ', 'ω', 'Α', 'Θ', 'Σ', 'Ω']) {
      expect(xml, character).toContain(`<m:t>${character}</m:t>`)
    }
  })

  test('writes each operator macro as the character it stands for', async () => {
    const xml = await ommlOf(OPERATORS.map(([macro]) => macro).join(' '))

    for (const [macro, character] of OPERATORS) {
      expect(xml, macro).toContain(`<m:t>${character}</m:t>`)
    }
  })

  test('turns a thin space into an ordinary one and a negative space into none', async () => {
    for (const spacer of ['\\,', '\\;', '\\:', '\\ ']) {
      expect(await ommlOf(`a${spacer}b`), spacer).toContain('<m:t> ')
    }

    // A word-shaped macro needs something after it to end its name, exactly as
    // it does in TeX: `\quadb` is an undefined control word, not a wide space.
    for (const spacer of ['\\quad ', '\\qquad ', '\\quad{}']) {
      expect(await ommlOf(`a${spacer}b`), spacer).toContain('<m:t> ')
    }

    expect(ommlFor('a\\quadb'), 'an undefined control word').toBeNull()

    expect(await ommlOf('a\\!b')).toBe(
      '<m:oMath><m:r><m:t>a</m:t></m:r><m:r><m:t>b</m:t></m:r></m:oMath>',
    )
  })

  test('drops the marks that line rows up, because one line has no rows', async () => {
    expect(await ommlOf('a \\\\ b & c')).toBe(
      '<m:oMath><m:r><m:t>a</m:t></m:r><m:r><m:t>b</m:t></m:r><m:r><m:t>c</m:t></m:r></m:oMath>',
    )
  })
})

describe('a formula it does not know', () => {
  test('is turned down whole when it opens an environment', () => {
    expect(ommlFor('\\begin{matrix} a & b \\\\ c & d \\end{matrix}')).toBeNull()
  })

  test('is turned down whole for one macro it has no shape for', () => {
    for (const tex of ['\\overbrace{x}', '\\vec{x}', '\\mathbb{R}', 'a + \\hat{b}']) {
      expect(ommlFor(tex), tex).toBeNull()
    }
  })

  test('is turned down when a bracket or a group never closes', () => {
    for (const tex of ['(x', '[x', '\\{x', '\\left(x', '\\frac{a}{b', '{a']) {
      expect(ommlFor(tex), tex).toBeNull()
    }
  })

  test('is turned down when a script has nothing to sit on or nothing to say', () => {
    for (const tex of ['^2', '_i', 'x^', 'x^2^3', 'x_1_2']) {
      expect(ommlFor(tex), tex).toBeNull()
    }
  })

  test('is turned down when it comes to nothing at all', () => {
    for (const tex of ['', '   ', '\\\\', '&']) {
      expect(ommlFor(tex), JSON.stringify(tex)).toBeNull()
    }
  })
})
