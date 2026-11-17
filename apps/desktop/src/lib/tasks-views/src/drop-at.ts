export function dropAt(at: number, y: number, box: { top: number; height: number }): number {
  return y > box.top + box.height / 2 ? at + 1 : at
}
