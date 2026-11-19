import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const E2E = join(import.meta.dirname, 'e2e')
const ASKING = `
import json, sys, time, types

api = types.ModuleType("playwright.sync_api")
api.Page = type("Page", (), {"on": lambda self, event, handler: None})
sys.modules["playwright"] = types.ModuleType("playwright")
sys.modules["playwright.sync_api"] = api
sys.path.insert(0, sys.argv[1])
import harness

class Handle:
    def __init__(self, value):
        self.value = value

    def json_value(self):
        return self.value

class Page:
    def __init__(self, answers):
        self.answers = answers
        self.asked = 0

    def answer(self):
        self.asked += 1
        return self.answers[min(self.asked, len(self.answers)) - 1]

    def wait_for_function(self, expression, **options):
        return Handle(self.answer())

    def evaluate(self, expression, arg=None):
        return self.answer()

    def wait_for_timeout(self, ms):
        time.sleep(ms / 1000)

page = Page(json.loads(sys.argv[2]))
try:
    came = harness.Drive.wait_for(None, page, "async () => window.ready", "it", float(sys.argv[3]))
except SystemExit as gave:
    came = str(gave)
print(json.dumps({"came": came, "asked": page.asked}))
`
function waited(answers: unknown[], patience: number): { came: unknown; asked: number } {
  const said = execFileSync('python3', ['-c', ASKING, E2E, JSON.stringify(answers), String(patience)], {
    encoding: 'utf8',
  })
  return JSON.parse(said) as { came: unknown; asked: number }
}
test('a drive waiting on an async check waits until its promise comes back true', () => {
  expect(waited([false, null, 0, { ready: true }], 10)).toEqual({ came: { ready: true }, asked: 4 })
})
test('a drive waiting on an async check that never comes true gives up', () => {
  expect(waited([false], 0.2).came).toBe('gave up waiting for it')
})
