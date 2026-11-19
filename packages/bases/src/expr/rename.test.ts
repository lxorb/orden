import { describe, expect, test } from 'vitest'
import { baseUnder, placedUnder } from './rename'

describe('a filter landed under a folder', () => {
  test('names the folders and paths it named, under that folder', () => {
    expect(placedUnder('file.inFolder("Projects")', 'Vault')).toBe('file.inFolder("Vault/Projects")')
    expect(placedUnder('file.inFolder("")', 'Vault')).toBe('file.inFolder("Vault")')
    expect(placedUnder('"Projects" == file.folder', 'Vault')).toBe('"Vault/Projects" == file.folder')
    expect(placedUnder('file.path.startsWith("/Projects/")', 'Vault/')).toBe('file.path.startsWith("Vault/Projects/")')
    expect(placedUnder('!(file.folder != "A") || file.inFolder("B")', 'In')).toBe(
      '!(file.folder != "In/A") || file.inFolder("In/B")',
    )
  })
  test('leaves alone what names no folder of the space', () => {
    for (const said of [
      'status == "Projects"',
      'file.name == "Projects"',
      'file.folder + ".md" == this.file.path',
      'this.file.folder == "Projects"',
      'file.inFolder(note.where)',
      'not a filter (',
    ]) {
      expect(placedUnder(said, 'Vault')).toBe(said)
    }
    expect(placedUnder('file.inFolder("Projects")', '')).toBe('file.inFolder("Projects")')
  })
  test('names a folder that stepped aside by the name it took', () => {
    const moved = (path: string) => path.replace(/^Tasks(?=\/|$)/, 'Tasks 2')
    expect(placedUnder('file.inFolder("Tasks") || file.inFolder("Home")', '', moved)).toBe(
      'file.inFolder("Tasks 2") || file.inFolder("Home")',
    )
    expect(placedUnder('file.path.startsWith("/Tasks/Sub/")', 'In', moved)).toBe(
      'file.path.startsWith("In/Tasks 2/Sub/")',
    )
    expect(baseUnder('filters: file.inFolder("Tasks")\n', '', moved)).toBe('filters: file.inFolder("Tasks 2")\n')
  })
  test('reads every filter and formula of a base, and keeps the rest as it was written', () => {
    const yaml = [
      '# mine',
      'filters:',
      '  or:',
      "    - file.inFolder('A')",
      '    - not:',
      '        - file.folder == "B"',
      'formulas:',
      '  where: file.inFolder("C")',
      'views:',
      '  - type: table',
      '    filters: file.inFolder("D")',
      '',
    ].join('\n')
    expect(baseUnder(yaml, 'In')).toBe(
      yaml
        .replace("file.inFolder('A')", 'file.inFolder("In/A")')
        .replace('"B"', '"In/B"')
        .replace('"C"', '"In/C"')
        .replace('"D"', '"In/D"'),
    )
    expect(baseUnder('views: [', 'In')).toBe('views: [')
  })
  test('reads the formulas of a base too, since a filter can read them', () => {
    const yaml = [
      'formulas:',
      '  mine: file.inFolder("Work") || file.folder == "Home"',
      '  size: file.size * 2',
      'filters: formula.mine',
      '',
    ].join('\n')
    expect(baseUnder(yaml, 'In')).toBe(yaml.replace('"Work"', '"In/Work"').replace('"Home"', '"In/Home"'))
  })
})
