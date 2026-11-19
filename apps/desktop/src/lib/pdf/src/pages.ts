export const PDF_TO_CSS = 96 / 72
export function sheetFor(
  at: { width: number; height: number },
  most: number,
  ratio: number,
): { width: number; height: number; drawn: { transform?: number[] } } {
  const room = Math.sqrt(most / (at.width * at.height))
  const density = Math.min(ratio, Math.max(1, room))
  return {
    width: Math.floor(at.width * density),
    height: Math.floor(at.height * density),
    drawn: density === 1 ? {} : { transform: [density, 0, 0, density, 0, 0] },
  }
}
