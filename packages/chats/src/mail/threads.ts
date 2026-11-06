export interface Threadable {
  key: string
  id: string
  links: readonly string[]
  at: number
}

export function threadsOf(mails: readonly Threadable[]): Map<string, string> {
  const parent = new Map<string, string>()
  const root = (id: string): string => {
    let at = id
    for (let next = parent.get(at); next !== undefined && next !== at; next = parent.get(at)) {
      parent.set(at, parent.get(next) ?? next)
      at = next
    }
    return at
  }
  const join = (a: string, b: string) => {
    const one = root(a)
    const two = root(b)
    if (one !== two) parent.set(two, one)
  }
  for (const mail of mails) {
    if (!parent.has(mail.id)) parent.set(mail.id, mail.id)
    for (const link of mail.links) {
      if (!parent.has(link)) parent.set(link, link)
      join(mail.id, link)
    }
  }
  const earliest = new Map<string, Threadable>()
  for (const mail of mails) {
    const group = root(mail.id)
    const held = earliest.get(group)
    if (!held || mail.at < held.at || (mail.at === held.at && mail.id < held.id)) {
      earliest.set(group, mail)
    }
  }
  return new Map(mails.map((mail) => [mail.key, earliest.get(root(mail.id))?.id ?? mail.id]))
}

export function bareSubject(subject: string): string {
  return subject.replace(/^\s*((re|fwd?|aw|wg|sv|vs|antw)(\[\d+\])?\s*:\s*)+/i, '').trim()
}
