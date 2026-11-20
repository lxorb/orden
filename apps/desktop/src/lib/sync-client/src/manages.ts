export function manages(listed: { role: string; admin?: boolean }): boolean {
  return listed.role === 'owner' || listed.admin === true
}
