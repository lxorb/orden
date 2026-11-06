export interface Person {
  name: string | null
  email: string
}

export function called(person: Person): string {
  const chosen = person.name?.trim()
  if (chosen) return chosen

  return person.email.split('@')[0] ?? person.email
}
