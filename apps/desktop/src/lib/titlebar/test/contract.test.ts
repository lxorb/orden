import { describe, expect, test } from 'vitest'

describe('the title bar', () => {
  test('hands over the bar and the sidebar toggle it shares, and nothing else', async () => {
    expect(Object.keys(await import('../src/api')).sort()).toEqual(['SidebarToggle', 'Titlebar'])
  })
})
