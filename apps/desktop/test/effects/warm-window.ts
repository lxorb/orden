export async function warmWindow(draw: () => () => void, ready: () => boolean): Promise<void> {
  const takeDown = draw()
  const until = Date.now() + 300_000
  while (!ready() && Date.now() < until) await new Promise((done) => setTimeout(done, 50))
  takeDown()
}
