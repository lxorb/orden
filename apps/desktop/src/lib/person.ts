/** What to call somebody.
 *
 *  The name on their account when they have chosen one, else the part of their
 *  address in front of the at sign - which is, near enough always, what they
 *  called themselves. Never the whole address: an address is not a name, and it
 *  is not necessarily something the other people in a space were given.
 *
 *  Its own file because three unrelated places say it: the Share sheet, the
 *  label on a caret, and the sentence a link's page shows. The service says the
 *  same thing in spaces/share.ts, for the mail it sends. */

export interface Person {
  name: string | null
  email: string
}

export function called(person: Person): string {
  const chosen = person.name?.trim()
  if (chosen) return chosen

  return person.email.split('@')[0] ?? person.email
}
