const NAME = 'orden'
export const FORMER_DATABASE = 'nib'
export function formerDatabase(name: string): string {
  return name.startsWith(NAME) ? FORMER_DATABASE + name.slice(NAME.length) : name
}
