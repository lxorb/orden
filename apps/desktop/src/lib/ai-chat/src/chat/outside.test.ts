import { describe, expect, test } from 'vitest'
import { heardTools, outsideTool } from './outside'

describe('a tool from an MCP server', () => {
  test('is shown by its own name beside the server it came from', () => {
    heardTools([
      { name: 'mcp__github__search_issues', description: 'GitHub: Searches the issues of a repository.' },
      { name: 'read_note', description: 'Notes: reads a note.' },
    ])
    expect(outsideTool('mcp__github__search_issues')).toEqual({ tool: 'search_issues', server: 'GitHub' })
  })
  test('is named by the server’s id where its description names no server', () => {
    heardTools([{ name: 'mcp__files-2__list', description: 'Lists the files.' }])
    expect(outsideTool('mcp__files-2__list')).toEqual({ tool: 'list', server: 'files-2' })
    expect(outsideTool('mcp__never-listed__a__b')).toEqual({ tool: 'a__b', server: 'never-listed' })
  })
  test('is not one of Orden’s own, nor a name of another shape', () => {
    expect(outsideTool('mcp__orden__edit_note')).toBeNull()
    expect(outsideTool('mcp__nib__edit_note')).toBeNull()
    expect(outsideTool('read_note')).toBeNull()
    expect(outsideTool('orden__read_note')).toBeNull()
    expect(outsideTool('mcp____x')).toBeNull()
  })
})
