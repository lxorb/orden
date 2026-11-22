const PX_PER_INCH = 96
export interface PdfPreview {
  html: string
  width: number
  height: number
}
interface Page {
  width: number
  height: number
  margin: number
  landscape: boolean
}
export function previewOf(html: string, page: Page): PdfPreview {
  const margin = `${page.margin}in`
  const css = [
    `html { height: 100vh; overflow: hidden; box-sizing: border-box; padding: ${margin}; background: #ffffff; }`,
    'body { height: 100%; overflow: hidden; margin: 0; }',
    `.running-footer { bottom: ${margin}; left: ${margin}; right: ${margin}; }`,
  ].join('\n')
  const cut = html.indexOf('</head>')
  const shown =
    cut < 0
      ? html
      : `${html.slice(0, cut).replaceAll('@media print', '@media all')}<style>\n${css}\n</style>\n${html.slice(cut)}`
  const [across, down] = page.landscape ? [page.height, page.width] : [page.width, page.height]
  return { html: shown, width: across * PX_PER_INCH, height: down * PX_PER_INCH }
}
