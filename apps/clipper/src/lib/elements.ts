/** What a note never contains.
 *
 *  Chrome, layout and interaction, none of which survives the trip into
 *  markdown: a script's source would arrive as a paragraph of code, a stylesheet
 *  as a paragraph of rules. Named once here because two layers act on the list -
 *  the DOM cleaning in `extract.ts` takes the elements out, and the converter in
 *  `markdown.ts` refuses them again in case something reached it another way. */
export const NEVER = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'form',
  'button',
  'select',
  'textarea',
  'svg',
  'canvas',
  'video',
  'audio',
]

/** The same list as one selector, plus the two things only a DOM can see: a
 *  field that is not a task list's tick, and whatever the page itself says is
 *  decoration rather than content. */
export const NOT_CONTENT = [...NEVER, 'input:not([type="checkbox"])', '[aria-hidden="true"]'].join(
  ',',
)
