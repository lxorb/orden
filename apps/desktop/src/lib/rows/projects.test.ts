import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Each space's projects folder: `Projects` unless the space moved it, following the
 *  folder through a rename and its space through one, and forgotten with its space. */

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { projectFolders, projectsFolder } = await import('./projects')

const ROOT = '/spaces/Work'

beforeEach(() => localStorage.clear())

describe('the projects folder', () => {
  test('is Projects at the root of a space that says nothing else', () => {
    expect(projectsFolder(ROOT)).toBe('/spaces/Work/Projects')
    expect(localStorage.length).toBe(0)
  })

  test('follows the folder when it is renamed, and its space when that is', () => {
    projectFolders.moved?.('/spaces/Work/Projects', '/spaces/Work/Plans', ROOT)
    expect(projectsFolder(ROOT)).toBe('/spaces/Work/Plans')

    projectFolders.spaceMoved?.(ROOT, '/spaces/Job')
    expect(projectsFolder('/spaces/Job')).toBe('/spaces/Job/Plans')

    projectFolders.moved?.('/spaces/Job/Plans', '/spaces/Job/Projects', '/spaces/Job')
    expect(projectsFolder('/spaces/Job')).toBe('/spaces/Job/Projects')
    expect(localStorage.length).toBe(0)
  })

  test('is forgotten with its space, and a note moved elsewhere moves nothing', () => {
    projectFolders.moved?.('/spaces/Work/Projects', '/spaces/Work/Plans', ROOT)
    projectFolders.moved?.('/spaces/Work/Other.md', '/spaces/Work/Another.md', ROOT)
    expect(projectsFolder(ROOT)).toBe('/spaces/Work/Plans')
    projectFolders.forget?.(ROOT)
    expect(projectsFolder(ROOT)).toBe('/spaces/Work/Projects')
  })
})
