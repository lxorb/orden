import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ANDROID = join(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'main')
const SOURCE = join(HERE, '..', 'src')

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

const manifest = read(ANDROID, 'AndroidManifest.xml')
const activity = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'MainActivity.kt')
const shared = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'Shared.kt')
const tiles = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'Tiles.kt')
const widgets = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'Widgets.kt')
const layout = read(ANDROID, 'res', 'layout', 'widget_notes.xml')
const provider = read(ANDROID, 'res', 'xml', 'widget_notes.xml')
const proguard = read(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'proguard-rules.pro')

const mobile = read(HERE, '..', '..', '..', 'docs', 'mobile.md')

const lockLayout = () => read(ANDROID, 'res', 'layout', 'widget_notes_lock.xml')

const rowsIn = (text: string) =>
  [...text.matchAll(/@\+id\/nib_row_(\d+)/g)].map((one) => Number(one[1]))

const commands = read(SOURCE, 'lib', 'commands.ts')
const bridge = read(SOURCE, 'lib', 'mobile', 'bridge.ts')

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sources(path, found)
    else if (/\.(ts|svelte)$/.test(entry.name)) found.push(path)
  }

  return found
}

const page = sources(SOURCE)
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

describe('what Android may copy out of the app', () => {
  test('nothing: no cloud backup and no transfer to a new phone', () => {
    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"')

    const rules = read(ANDROID, 'res', 'xml', 'data_extraction_rules.xml')
    expect(rules).toContain('<cloud-backup>')
    expect(rules).toContain('<device-transfer>')
  })
})

describe('what the app asks the phone for', () => {
  test('the microphone, for dictation, the reminders, and nothing else beyond the network', () => {
    const asked = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map(
      (one) => one[1],
    )

    expect(asked).toEqual([
      'android.permission.INTERNET',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ])
  })

  test('not the camera, which is the camera app’s own business', () => {
    expect(manifest).not.toContain('android.permission.CAMERA')
  })

  test('to see the camera app and the recogniser, or neither would answer', () => {
    expect(manifest).toContain('<queries>')
    expect(manifest).toContain('android.media.action.IMAGE_CAPTURE')
    expect(manifest).toContain('android.speech.RecognitionService')
  })
})

describe('what another app may share with nib', () => {
  test('one thing and several things, each copied into a space', () => {
    expect(manifest).toContain('android.intent.action.SEND"')
    expect(manifest).toContain('android.intent.action.SEND_MULTIPLE"')
  })

  test('never a file to open where it lies', () => {
    const views = [...manifest.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)]
      .map((one) => one[1] ?? '')
      .filter((filter) => filter.includes('android.intent.action.VIEW"'))

    expect(views).toHaveLength(1)
    expect(views[0]).toContain('android:scheme="nib"')
    expect(manifest).not.toContain('android:scheme="content"')
    expect(manifest).not.toContain('android:scheme="file"')
    expect(manifest).not.toContain('android:mimeType="text/markdown"')
    expect(shared).not.toContain('ACTION_VIEW')
  })

  test('through the activity that is already open', () => {
    expect(manifest).toContain('android:launchMode="singleTask"')
    expect(manifest).toContain('android:name=".MainActivity"')
    expect(activity).toContain('override fun onNewIntent')
    expect(activity).toContain('Shared.take(this, intent)')
  })
})

describe('the press that started the app', () => {
  test('is not read again when the activity comes back', () => {
    const created = /override fun onCreate\([\s\S]*?\n {2}\}/.exec(activity)?.[0] ?? ''
    expect(created).toMatch(/savedInstanceState == null/)
    expect(created).toContain('FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY')
    expect(created).toContain('if (fresh) read(intent)')
  })

  test('is only acted on when the app sealed it', () => {
    const reading = /private fun read\(intent: Intent\?\)[\s\S]*?\n {2}\}/.exec(activity)?.[0] ?? ''
    const ours = reading.indexOf('sealedBy(this, intent)')
    expect(ours).toBeGreaterThan(-1)
    for (const extra of ['EXTRA_COMMAND', 'EXTRA_OPEN', 'EXTRA_TICK', 'Reminders.carried']) {
      expect(reading.indexOf(extra), extra).toBeGreaterThan(ours)
    }

    const senders = {
      tiles,
      widgets,
      today: read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'TodayWidget.kt'),
      reminders: read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'Reminders.kt'),
    }
    for (const [name, text] of Object.entries(senders)) {
      const made = text.match(/Intent\(\w+, MainActivity::class\.java\)/g) ?? []
      const sealed =
        text.match(/MainActivity\.sealed\(\s*\w+,\s*Intent\(\w+, MainActivity::class\.java\)/g) ??
        []
      expect(made.length, name).toBeGreaterThan(0)
      expect(sealed.length, name).toBe(made.length)
    }
  })
})

describe('the quick settings tiles', () => {
  const declared = [
    ...manifest.matchAll(/<service\s+android:name="\.(\w+Tile)"([\s\S]*?)<\/service>/g),
  ]

  test('are the three the page can answer', () => {
    expect(declared.map((one) => one[1])).toEqual(['NewNoteTile', 'SearchTile', 'RecordTile'])
  })

  test('each bound as a tile and nothing else', () => {
    for (const [, name, body = ''] of declared) {
      expect(body, name).toContain('android.permission.BIND_QUICK_SETTINGS_TILE')
      expect(body, name).toContain('android.service.quicksettings.action.QS_TILE')
      expect(body, name).toContain('android:exported="true"')
    }
  })

  test('carry command ids the app has, and every one of them is on', () => {
    const ids = [...tiles.matchAll(/override val command = "([\w.-]+)"/g)].map((one) => one[1])
    expect(ids).toEqual(['new', 'search-space', 'record'])

    for (const id of ids) expect(commands, id).toContain(`id: '${id}'`)

    for (const [, name, body = ''] of declared) {
      expect(body.includes('android:enabled="false"'), name).toBe(false)
    }
  })

  test('send only ids the page will run from a press', () => {
    const today = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'TodayWidget.kt')
    const sent = [
      ...[...tiles.matchAll(/override val command = "([\w.-]+)"/g)].map((one) => one[1]),
      ...[...`${widgets}${today}`.matchAll(/command\(context, "([\w.-]+)"/g)].map((one) => one[1]),
    ]
    const handed = read(SOURCE, 'lib', 'mobile', 'handed.ts')
    const list = /HANDED[^[]*\[([^\]]*)\]/.exec(handed)?.[1] ?? ''
    expect(new Set(sent)).toEqual(new Set([...list.matchAll(/'([\w.-]+)'/g)].map((one) => one[1])))
  })

  test('and nothing written beside them claims a switch that is not there', () => {
    expect(manifest).not.toContain('android:enabled')
    expect(mobile).not.toContain('android:enabled')
  })
})

describe('the home screen widget', () => {
  test('is declared, with the provider that describes it', () => {
    expect(manifest).toContain('android:name=".NotesWidget"')
    expect(manifest).toContain('android.appwidget.action.APPWIDGET_UPDATE')
    expect(manifest).toContain('android:resource="@xml/widget_notes"')
  })

  test('has a row for every note the page sends', () => {
    const state = read(SOURCE, 'lib', 'mobile', 'widgets.svelte.ts')
    const most = Number(/const MOST = (\d+)/.exec(state)?.[1] ?? 0)
    expect(most).toBeGreaterThan(0)

    const inProvider = [...widgets.matchAll(/R\.id\.nib_row_(\d+)/g)].map((one) => Number(one[1]))

    expect(rowsIn(layout)).toEqual([...Array(most).keys()])
    expect(inProvider).toEqual([...Array(most).keys()])
  })

  test('is drawn in the app’s own colours, light and dark', () => {
    const light = read(ANDROID, 'res', 'values', 'colors.xml')
    const dark = read(ANDROID, 'res', 'values-night', 'colors.xml')

    for (const name of ['widget_text', 'widget_muted']) {
      expect(light, name).toContain(`name="${name}"`)
      expect(dark, name).toContain(`name="${name}"`)
    }
  })

  test('is offered to the home screen', () => {
    expect(provider).toContain('home_screen')
  })

  test('says its own words in both languages the app has', () => {
    const english = read(ANDROID, 'res', 'values', 'strings.xml')
    const german = read(ANDROID, 'res', 'values-de', 'strings.xml')
    const names = (text: string) => [...text.matchAll(/<string name="(\w+)"/g)].map((one) => one[1])

    expect(names(german)).toEqual(
      names(english).filter((one) => one !== 'app_name' && one !== 'main_activity_title'),
    )
  })
})

describe('the lock screen widget', () => {
  test('is the same provider, offered to the keyguard as well', () => {
    expect(provider).toContain('android:widgetCategory="home_screen|keyguard"')
    expect(provider).toContain('android:initialKeyguardLayout="@layout/widget_notes_lock"')
  })

  test('is the same drawing, cut short', () => {
    const lock = lockLayout()

    for (const id of ['nib_title', 'nib_search', 'nib_new', 'nib_empty']) {
      expect(lock, id).toContain(`@+id/${id}`)
    }
    expect(lock).toContain('@drawable/widget_page')
    expect(lock).toContain('@style/NibWidgetRow')

    const shorter = rowsIn(lock)
    expect(shorter.length).toBeGreaterThan(0)
    expect(shorter.length).toBeLessThan(rowsIn(layout).length)
    expect(shorter).toEqual(rowsIn(layout).slice(0, shorter.length))
  })

  test('is drawn by a provider that asks which surface it is on', () => {
    expect(widgets).toContain('OPTION_APPWIDGET_HOST_CATEGORY')
    expect(widgets).toContain('WIDGET_CATEGORY_KEYGUARD')
    expect(widgets).toContain('R.layout.widget_notes_lock')
    expect(widgets).toContain('override fun onAppWidgetOptionsChanged')
  })

  test('is written down, with which phones actually show it', () => {
    expect(mobile).toMatch(/lock screen/i)
    expect(mobile).toContain('keyguard')
  })
})

describe('the bridge the page talks over', () => {
  const kotlin = [...activity.matchAll(/@JavascriptInterface\s+fun\s+(\w+)/g)].map((one) => one[1])
  const typed = [...bridge.matchAll(/^ {2}(\w+)\(/gm)].map((one) => one[1])

  const HARMLESS = ['insets', 'askForTheFrame', 'bars', 'dictates', 'exactAlarms', 'askExactAlarms']
  const GUARDED = kotlin.filter((name) => name !== undefined && !HARMLESS.includes(name))

  test('wants the word for everything but how the window looks', () => {
    expect(GUARDED).toEqual(
      expect.arrayContaining(['handed', 'shared', 'sharedBytes', 'sharedDone', 'widgets']),
    )
    expect(GUARDED).toContain('remindersTaken')
    for (const name of GUARDED) {
      expect(bridge, `${name} is typed with the word first`).toMatch(
        new RegExp(`^ {2}${name}\\(said: string`, 'm'),
      )
      expect(page, `${name} is never called without the word`).not.toMatch(
        new RegExp(`method\\('${name}'\\)\\?\\.\\(\\)`),
      )
    }
  })

  test('is the same list on both sides', () => {
    expect(kotlin.length).toBeGreaterThan(5)
    expect([...kotlin].sort()).toEqual([...typed].sort())
  })

  test('asks for this launch’s word before a key or the microphone', () => {
    expect(activity).toContain('private val frame: String = UUID.randomUUID()')
    expect(activity).toContain('fun askForTheFrame()')
    expect(activity).toContain('window.__nibFrame?.(')

    for (const name of GUARDED) {
      const found = new RegExp(`fun ${name}\\(\\s*said: String`).test(activity)
      expect(found, `${name} takes the word first`).toBe(true)
      expect(activity, `${name} checks the word`).toMatch(
        new RegExp(`fun ${name}\\([\\s\\S]{0,200}?said [!=]= frame`),
      )
    }

    expect(page).toContain(`answer('__nibFrame'`)
    for (const call of [
      'const said = await frameWord()',
      'if (!said) throw new NoWord()',
      'secretRead(await word(), id)',
      'secretWrite(await word(), id, secret)',
      'secretForget(await word(), id)',
    ]) {
      expect(page, call).toContain(call)
    }
  })

  test('asks for a version of the keystore library that has what it imports', () => {
    const gradle = read(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts')
    if (!activity.includes('MasterKey')) return

    const version = /androidx\.security:security-crypto:(\d+)\.(\d+)\.(\d+)/.exec(gradle)
    expect(version, 'the keystore library is not declared').not.toBe(null)

    const [major, minor] = [Number(version?.[1]), Number(version?.[2])]
    expect(major * 1000 + minor, `security-crypto ${version?.[0] ?? ''}`).toBeGreaterThanOrEqual(
      1001,
    )
  })

  test('is kept whole by a release build', () => {
    expect(proguard).toContain('class ch.emilvinu.nib.MainActivity$Bridge')
    expect(proguard).toContain('@android.webkit.JavascriptInterface <methods>')
  })

  test('every line the activity runs in the page is answered', () => {
    const called = [...activity.matchAll(/window\.(__nib\w+)/g)].map((one) => one[1])
    expect(called.length).toBeGreaterThan(2)

    for (const name of called) {
      expect(page, name).toContain(`answer('${name}'`)
    }
  })
})

describe('what a release build shrinks', () => {
  const gradle = read(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts')
  const workflow = read(HERE, '..', '..', '..', '.github', 'workflows', 'check.yml')

  test('is told which missing classes are meant to be missing', () => {
    if (!gradle.includes('androidx.security:security-crypto')) return

    expect(proguard).toContain('-dontwarn javax.annotation.Nullable')
    expect(proguard).toContain('-dontwarn javax.annotation.concurrent.GuardedBy')
    expect(proguard).not.toContain('-dontwarn javax.annotation.**')
  })

  test('is what the pull request assembles, not only what a release does', () => {
    const job = workflow.slice(workflow.indexOf('android-check:'))
    const built = /tauri android build(?:[^\n]*\\\n)*[^\n]*/.exec(job)?.[0] ?? ''

    expect(built).toContain('--apk')
    expect(built, 'a debug assembly does not run R8').not.toContain('--debug')
  })
})

describe('the Today widget', () => {
  const today = read(ANDROID, 'res', 'layout', 'widget_today.xml')
  const kotlin = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'TodayWidget.kt')

  test('is declared, with the provider that describes it', () => {
    expect(manifest).toContain('android:name=".TodayWidget"')
    expect(manifest).toContain('android:resource="@xml/widget_today"')
    expect(read(ANDROID, 'res', 'xml', 'widget_today.xml')).toContain('home_screen')
  })

  test('has a box and the words for every task the page sends', () => {
    const state = read(SOURCE, 'lib', 'mobile', 'widgets.svelte.ts')
    const most = Number(/const MOST = (\d+)/.exec(state)?.[1] ?? 0)
    const ids = (kind: string, text: string) =>
      [...text.matchAll(new RegExp(String.raw`nib_today_${kind}_(\d+)`, 'g'))].map((one) =>
        Number(one[1]),
      )

    for (const kind of ['row', 'box', 'text']) {
      expect(ids(kind, today), kind).toEqual([...Array(most).keys()])
      expect(ids(kind, kotlin), kind).toEqual([...Array(most).keys()])
    }
  })

  test('ticks through the page, which reads the anchor the activity hands over', () => {
    expect(kotlin).toContain('MainActivity.EXTRA_TICK')
    expect(activity).toContain('json.put("tick", ticking)')
    expect(read(SOURCE, 'lib', 'mobile', 'handed.ts')).toContain('tickTask(at, space, true)')
    expect(widgets).toContain('TodayWidget.refresh(context)')
  })
})
