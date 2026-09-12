import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The Android project, held to what the page believes about it.
 *
 *  None of this can be run on the machine it is written on: an emulator does not
 *  run on Windows on ARM, and the one thing that compiles the Kotlin is the
 *  `android-check` job in check.yml. What a compiler would not catch either is the
 *  drift between the two sides - a method renamed in Kotlin and still called from
 *  the page, a tile carrying a command id nothing answers to, a widget layout with
 *  four rows where the page sends five - and that is what this is for.
 *
 *  Everything here is read off the files rather than written down twice. A list of
 *  what the manifest ought to say would go stale the first time somebody added a
 *  row to it; what these ask is that the two sides agree. */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ANDROID = join(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'main')
const SOURCE = join(HERE, '..', 'src')

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

const manifest = read(ANDROID, 'AndroidManifest.xml')
const activity = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'MainActivity.kt')
const tiles = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'Tiles.kt')
const widgets = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'Widgets.kt')
const layout = read(ANDROID, 'res', 'layout', 'widget_notes.xml')
const proguard = read(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'proguard-rules.pro')

const commands = read(SOURCE, 'lib', 'commands.ts')
const bridge = read(SOURCE, 'lib', 'mobile', 'bridge.ts')

/** Every `.ts` and `.svelte` under `src`, for the questions that are about the
 *  page as a whole rather than one file of it. */
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
  /** The reason is in the manifest itself and in docs/mobile.md: a note is the
   *  most private thing here, the account is the backup, and a new install needs
   *  none of it. */
  test('nothing: no cloud backup and no transfer to a new phone', () => {
    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"')

    const rules = read(ANDROID, 'res', 'xml', 'data_extraction_rules.xml')
    expect(rules).toContain('<cloud-backup>')
    expect(rules).toContain('<device-transfer>')
  })
})

describe('what the app asks the phone for', () => {
  test('the microphone, for dictation, and nothing else beyond the network', () => {
    const asked = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map(
      (one) => one[1],
    )

    expect(asked).toEqual(['android.permission.INTERNET', 'android.permission.RECORD_AUDIO'])
  })

  /** Deliberate, and load-bearing: the webview offers the camera for a `capture`
   *  input only when the app has the CAMERA permission *or* has not declared it at
   *  all. Declaring it and not holding it is the one state where the camera row
   *  does nothing. See wry's RustWebChromeClient. */
  test('not the camera, which is the camera app’s own business', () => {
    expect(manifest).not.toContain('android.permission.CAMERA')
  })

  /** From Android 11 an app sees only the other apps it has named, and both of
   *  these are asked with a question before they are used. */
  test('to see the camera app and the recogniser, or neither would answer', () => {
    expect(manifest).toContain('<queries>')
    expect(manifest).toContain('android.media.action.IMAGE_CAPTURE')
    expect(manifest).toContain('android.speech.RecognitionService')
  })
})

describe('what another app may share with nib', () => {
  test('one thing, several things, and a note opened from somewhere else', () => {
    expect(manifest).toContain('android.intent.action.SEND"')
    expect(manifest).toContain('android.intent.action.SEND_MULTIPLE"')
    expect(manifest).toContain('android.intent.action.VIEW"')
    expect(manifest).toContain('android:mimeType="text/markdown"')
  })

  /** The filters are on the launcher activity rather than on one of their own,
   *  which is what puts the app's own icon in the share sheet's row and what makes
   *  the second share arrive in the app that is already open. */
  test('through the activity that is already open', () => {
    expect(manifest).toContain('android:launchMode="singleTask"')
    expect(manifest).toContain('android:name=".MainActivity"')
    expect(activity).toContain('override fun onNewIntent')
    expect(activity).toContain('Shared.take(this, intent)')
  })
})

describe('the quick settings tiles', () => {
  const declared = [...manifest.matchAll(/<service\s+android:name="\.(\w+Tile)"([\s\S]*?)<\/service>/g)]

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

  /** The whole of the wiring: a tile carries the id of a row in the app's own
   *  registry. A tile whose id nothing answers to would be a tile that does
   *  nothing, which is why the recorder's is turned off rather than shipped. */
  test('carry command ids the app has, except the recorder’s, which is off', () => {
    const ids = [...tiles.matchAll(/override val command = "([\w.-]+)"/g)].map((one) => one[1])
    expect(ids).toEqual(['new', 'search-space', 'record'])

    expect(commands).toContain("id: 'new'")
    expect(commands).toContain("id: 'search-space'")
    // The recorder is another batch. Until it lands the tile would be a row that
    // does nothing, so the service is turned off and the picker never offers it.
    expect(commands, 'the recorder has landed: turn its tile on').not.toContain("id: 'record'")

    for (const [, name, body = ''] of declared) {
      const off = body.includes('android:enabled="false"')
      expect(off, name).toBe(name === 'RecordTile')
    }
  })
})

describe('the home screen widget', () => {
  test('is declared, with the provider that describes it', () => {
    expect(manifest).toContain('android:name=".NotesWidget"')
    expect(manifest).toContain('android.appwidget.action.APPWIDGET_UPDATE')
    expect(manifest).toContain('android:resource="@xml/widget_notes"')
  })

  /** The page decides which notes and how many; the layout has to have room for
   *  exactly that many, because a row the launcher has no view for is a note
   *  nobody sees. */
  test('has a row for every note the page sends', () => {
    const state = read(SOURCE, 'lib', 'mobile', 'widgets.svelte.ts')
    const most = Number(/const MOST = (\d+)/.exec(state)?.[1] ?? 0)
    expect(most).toBeGreaterThan(0)

    const inLayout = [...layout.matchAll(/@\+id\/nib_row_(\d+)/g)].map((one) => Number(one[1]))
    const inProvider = [...widgets.matchAll(/R\.id\.nib_row_(\d+)/g)].map((one) => Number(one[1]))

    expect(inLayout).toEqual([...Array(most).keys()])
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

  test('says its own words in both languages the app has', () => {
    const english = read(ANDROID, 'res', 'values', 'strings.xml')
    const german = read(ANDROID, 'res', 'values-de', 'strings.xml')
    const names = (text: string) =>
      [...text.matchAll(/<string name="(\w+)"/g)].map((one) => one[1]).filter((one) => one !== null)

    // The app's own name is the same word in both, so the German file holds
    // everything but those two.
    expect(names(german)).toEqual(
      names(english).filter((one) => one !== 'app_name' && one !== 'main_activity_title'),
    )
  })
})

describe('the bridge the page talks over', () => {
  const kotlin = [...activity.matchAll(/@JavascriptInterface\s+fun\s+(\w+)/g)].map((one) => one[1])
  const typed = [...bridge.matchAll(/^ {2}(\w+)\(/gm)].map((one) => one[1])

  test('is the same list on both sides', () => {
    expect(kotlin.length).toBeGreaterThan(5)
    expect([...kotlin].sort()).toEqual([...typed].sort())
  })

  /** A release build minifies, so a method the page calls by name and proguard
   *  does not keep is a method that is there in debug and gone in the APK
   *  somebody installs. */
  test('is kept whole by a release build', () => {
    expect(proguard).toContain('class ch.emilvinu.nib.MainActivity$Bridge')
    expect(proguard).toContain('@android.webkit.JavascriptInterface <methods>')
  })

  /** And the other direction: everything the activity runs in the page is
   *  something the page puts there. */
  test('every line the activity runs in the page is answered', () => {
    const called = [...activity.matchAll(/window\.(__nib\w+)/g)].map((one) => one[1])
    expect(called.length).toBeGreaterThan(2)

    for (const name of called) {
      expect(page, name).toContain(`answer('${name}'`)
    }
  })
})
