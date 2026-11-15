import { describe, expect, test } from 'vitest'
import { SidebarToggle, Titlebar } from '../src/api'

describe('the title bar', () => {
  test('hands over the bar and the sidebar toggle it shares with the sidebars', () => {
    expect(typeof Titlebar).toBe('function')
    expect(typeof SidebarToggle).toBe('function')
  })
})
