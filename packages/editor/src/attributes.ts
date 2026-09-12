/** Text as the value of a double-quoted HTML attribute.
 *
 *  Only `&` and `"`, because what goes through here is a URL or a word the note
 *  wrote and the attribute is a `"…"`: neither character may survive there, and
 *  nothing else in it can end the attribute or open a tag.
 *
 *  Not @nib/markdown's `escape`, which leaves an `&` that already opens an entity
 *  alone. That is right for prose - a note that wrote `&amp;` meant the ampersand
 *  - and wrong for a URL, where the entity is what the browser would decode back
 *  into a scheme. Two places here write such an attribute and each had its own
 *  copy of this, one of them under a name that meant the opposite next door. */
export function attributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
