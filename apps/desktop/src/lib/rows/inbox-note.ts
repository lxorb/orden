export async function inboxNote(): Promise<string | null> {
  const { inboxPath } = await import('../inbox/start.svelte')
  return inboxPath()
}
