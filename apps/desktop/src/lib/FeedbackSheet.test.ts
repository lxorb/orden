import { describe, expect, test } from 'vitest'
import { render } from 'svelte/server'

const { feedback } = await import('./feedback.svelte')
const FeedbackSheet = (await import('./FeedbackSheet.svelte')).default

describe('the sheet', () => {
  test('asks for the words and offers pictures until a report is received', () => {
    feedback.show()
    const html = render(FeedbackSheet).body
    expect(html).toContain('Describe the issue')
    expect(html).toContain('Add images')
    expect(html).toContain('accept="image/*"')
    expect(html).not.toContain('Report received')
  })

  test('confirms a received report and links its page', () => {
    feedback.show()
    feedback.received = { url: 'https://orden.so/v1/feedback/r1/key' }
    const html = render(FeedbackSheet).body
    expect(html).toContain('Report received')
    expect(html).toContain('href="https://orden.so/v1/feedback/r1/key"')
    expect(html).toContain('View your report')
    expect(html).not.toContain('Describe the issue')
  })
})
