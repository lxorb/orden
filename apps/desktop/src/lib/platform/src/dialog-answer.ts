export type DialogJudge = (write: boolean) => Promise<string | null>

let held: DialogJudge | null = null

export function answerNextDialog(judge: DialogJudge | null): void {
  held = judge
}

export function dialogAnswer(): DialogJudge | null {
  const judge = held
  held = null
  return judge
}
