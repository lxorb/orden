import json
import time

ACCOUNT = "[data-region=foot] button.who"
MENU = "[role=menu] [role=menuitem]"
PICKER = "[role=dialog][aria-label='Themes']"
NAMES = {"light": "Light", "dark": "Dark"}
SCHEME = "document.documentElement.dataset.theme"
CLOSE = (
    "(() => { const at = document.activeElement || document;"
    " at.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));"
    " return true })()"
)
GONE = f"!document.querySelector({json.dumps(PICKER)})"


def mode(scheme):
    return f"{PICKER} .modes button[aria-label='{NAMES[scheme]}']"


def kept(scheme):
    return f"{SCHEME} === {json.dumps(scheme)} && !!document.querySelector({json.dumps(mode(scheme) + '[aria-pressed=true]')})"


def themes_row(run):
    at = run(
        "[...document.querySelectorAll(%s)].find((one) => one.textContent.trim() === 'Themes')?.dataset.at ?? null"
        % json.dumps(MENU)
    )
    return None if at is None else f"{MENU}[data-at='{at}']"


def other(scheme):
    return "light" if scheme == "dark" else "dark"


def waited(run, code, seconds):
    for _ in range(int(seconds / 0.2)):
        if run(code):
            return True
        time.sleep(0.2)
    return False


def switch(run, box, press, want, seconds=4):
    if run(SCHEME) == want:
        return "kept"
    account = box(ACCOUNT)
    if not isinstance(account, dict):
        return "no account button"
    press(account)
    if not waited(run, f"!!document.querySelector({json.dumps(MENU)})", seconds):
        return "the account button opened no menu"
    row = themes_row(run)
    button = box(row) if row else None
    if not isinstance(button, dict):
        run(CLOSE)
        return "no Themes in the account menu"
    press(button)
    if not waited(run, f"!!document.querySelector({json.dumps(PICKER)})", seconds):
        return "Themes in the account menu opened no picker"
    choice = box(mode(want))
    if not isinstance(choice, dict):
        run(CLOSE)
        return f"the picker offers no {NAMES[want]}"
    press(choice)
    switched = waited(run, kept(want), seconds)
    run(CLOSE)
    if not waited(run, GONE, seconds):
        return "Escape left the picker open"
    return "switched" if switched else f"{NAMES[want]} in the picker left the app {run(SCHEME)}"


def clicked(run, want, seconds=4):
    said = run(
        "(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms));"
        " const account = document.querySelector(%s); if (!account) return 'no account button';"
        " account.click(); await wait(50);"
        " const row = [...document.querySelectorAll(%s)].find((one) => one.textContent.trim() === 'Themes');"
        " if (!row) return 'no Themes in the account menu'; row.click();"
        " for (let i = 0; i < 40 && !document.querySelector(%s); i++) await wait(50);"
        " const choice = document.querySelector(%s); if (!choice) return 'no choice in the picker';"
        " choice.click(); return 'pressed' })()"
        % (json.dumps(ACCOUNT), json.dumps(MENU), json.dumps(PICKER), json.dumps(mode(want)))
    )
    if said != "pressed":
        return said
    switched = waited(run, kept(want), seconds)
    run(CLOSE)
    if not waited(run, GONE, seconds):
        return "Escape left the picker open"
    return "switched" if switched else f"{NAMES[want]} in the picker left the app {run(SCHEME)}"
