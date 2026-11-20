import datetime
import json
import os
from playwright.sync_api import Browser, Page
import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
NEW = os.environ.get("SHOTS_KIND", "after") == "after"
NOW = datetime.datetime(2026, 11, 19, 15, 40)
GATE = (
    "try { localStorage.setItem('orden:hidden-kinds', JSON.stringify(['experimental', 'experimental-time'])) }"
    " catch {}"
)
SEED = """async () => {
  const time = await window.ordenApp.time()
  for (let tries = 0; !time.ready && tries < 100; tries += 1) await new Promise((go) => setTimeout(go, 50))
  const H = 3600000, M = 60000
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = (back) => { const one = new Date(today); one.setDate(one.getDate() - back); return one.getTime() }
  const made = {}
  for (const [name, tint, icon] of [['Work', 'blue', 'briefcase'], ['Uni', 'teal', 'graduation-cap'], ['Eating', 'orange', '🍝'], ['Break', 'green', 'coffee'], ['Sport', 'red', 'bike']]) {
    made[name] = time.addActivity(name, tint, null, icon).id
  }
  const plan = [
    [[8.5, 11.75, 'Work'], [11.75, 12.5, 'Eating'], [12.5, 15, 'Uni'], [15, 15.33, 'Break']],
    [[9, 12, 'Uni'], [12, 12.75, 'Eating'], [13, 17.5, 'Work'], [18, 19, 'Sport']],
    [[8, 10, 'Work'], [10, 12, 'Uni'], [12, 13, 'Eating'], [13, 16, 'Work']],
    [[9.5, 12, 'Work'], [12, 12.5, 'Break'], [12.5, 13.25, 'Eating'], [14, 18, 'Uni']],
    [[10, 13, 'Uni'], [13, 14, 'Eating'], [14, 16.5, 'Work'], [17, 18, 'Sport']],
  ]
  const apps = ['orden', 'firefox', 'Code', 'Terminal', 'Slack']
  const sites = ['moodle.ethz.ch', 'github.com', 'docs.python.org', 'youtube.com', 'mail.google.com', 'news.ycombinator.com']
  const spaces = ['Thesis', 'Uni', 'Personal']
  const tabs = ['Analysis.md', 'Terminal.term', 'Todo.md', 'Reading list.md', 'Plan.md']
  const minutes = []
  for (const [back, blocks] of plan.entries()) {
    const base = day(back)
    for (const [from, to, name] of blocks) time.addSpan({ start: base + from * H, end: base + to * H, activity: made[name], source: 'manual' })
    const first = back === 0 ? 7.5 : 8
    const last = back === 0 ? 15.66 : 18.5
    let at = base + first * H
    let index = back
    while (at < base + last * H) {
      const long = [4, 22, 9, 1.5, 15, 35, 6, 0.6, 12][index % 9] * M
      const end = Math.min(at + long, base + last * H)
      time.addSpan({ start: at, end, source: 'app', place: apps[index % apps.length], label: apps[index % apps.length] })
      time.addSpan({ start: at, end, source: 'site', place: sites[(index * 7) % sites.length], label: sites[(index * 7) % sites.length] })
      time.addSpan({ start: at, end, source: 'space', place: spaces[Math.floor(index / 5) % spaces.length], label: spaces[Math.floor(index / 5) % spaces.length] })
      time.addSpan({ start: at, end, source: 'tab', place: tabs[(index * 3) % tabs.length], label: tabs[(index * 3) % tabs.length] })
      at = end
      index += 1
    }
    for (let one = base + first * H; one < base + last * H; one += M) {
      const minute = Math.round((one - base) / M)
      const quiet = minute % 47 < 6 || (minute > 12 * 60 && minute < 12 * 60 + 30)
      minutes.push({ at: one, active: quiet ? 0 : 20 + ((minute * 13) % 41), samples: 12, lid: true, locked: false })
    }
  }
  time.keepMinutes(minutes)
  time.start(made.Work, day(0) + 15.33 * H)
  await new Promise((go) => setTimeout(go, 500))
  return Object.keys(made).length
}"""
def page_for(browser: Browser, scheme: str, width: int = 1440, height: int = 900) -> Page:
    context = browser.new_context(
        viewport={"width": width, "height": height}, color_scheme=scheme, timezone_id="Europe/Zurich"
    )
    context.add_init_script(harness.BUILT_IN)
    context.add_init_script(GATE)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.clock.install(time=NOW)
    page.clock.resume()
    page.wait_for_timeout(300)
    return page
def seeded(page: Page) -> None:
    page.evaluate(SEED)
def tab(page: Page, view: str) -> None:
    page.evaluate(
        f"() => window.ordenApp.workspace.openUnsaved('time', {json.dumps(json.dumps({'view': view}))}, 'Time tracker')"
    )
    page.wait_for_selector("[data-time-tab]", timeout=30000)
    page.wait_for_timeout(1500)


STATE = """() => {
  const tab = document.querySelector('[data-time-tab]')
  if (!tab) return null
  const on = tab.querySelector('[data-time-range] [role=radio][aria-checked=true]')
  const title = tab.querySelector('[data-time-range]')?.textContent.replace(/\\s+/g, ' ').trim()
  const scrollers = [tab, ...tab.querySelectorAll('*')].filter((one) => one.scrollTop > 0).map((one) => one.scrollTop)
  return { range: on?.textContent.trim(), title, untracked: tab.querySelector('[data-time-untracked]')?.getAttribute('aria-pressed'), scroll: scrollers, timeline: !!document.querySelector('[data-time-timeline]'), editor: !!tab.querySelector('[data-time-editor]') }
}"""
def main() -> int:
    with DRIVE.session() as browser:
        page = page_for(browser, "light", 1440, 700)
        seeded(page)
        tab(page, "day")
        page.locator("[data-time-range] [role=radio]", has_text="Week").first.click()
        page.wait_for_timeout(400)
        page.locator("[data-time-range] button[aria-label=Previous], [data-time-range] button[aria-label*=revious]").first.click()
        page.wait_for_timeout(400)
        page.locator("[data-time-untracked]").first.click()
        page.wait_for_timeout(300)
        page.evaluate("() => { const t = document.querySelector('[data-time-tab]'); for (const one of [t, ...t.querySelectorAll('*')]) if (one.scrollHeight > one.clientHeight + 50 && getComputedStyle(one).overflowY !== 'visible') { one.scrollTop = 300 } }")
        page.wait_for_timeout(300)
        before = page.evaluate(STATE)
        say(f"before {before}")
        page.locator(".pick[data-tab]", has_text="Read me").first.click()
        page.wait_for_timeout(800)
        page.locator(".pick[data-tab]", has_text="Time tracker").first.click()
        page.wait_for_timeout(1200)
        after = page.evaluate(STATE)
        say(f"after {after}")
        if before != after:
            wrong(f"state changed: {before} -> {after}")
        DRIVE.shot(page, "after-switch")
        page.context.close()
    return DRIVE.verdict("compared")
raise SystemExit(main())
