import json
import time

THEMES = "[data-region=foot] button.act[aria-label='Themes']"
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
    button = box(THEMES)
    if not isinstance(button, dict):
        return "no themes button"
    press(button)
    if not waited(run, f"!!document.querySelector({json.dumps(PICKER)})", seconds):
        return "the themes button opened no picker"
    choice = box(mode(want))
    if not isinstance(choice, dict):
        run(CLOSE)
        return f"the picker offers no {NAMES[want]}"
    press(choice)
    switched = waited(run, f"{SCHEME} === {json.dumps(want)}", seconds)
    run(CLOSE)
    if not waited(run, GONE, seconds):
        return "Escape left the picker open"
    return "switched" if switched else f"{NAMES[want]} in the picker left the app {run(SCHEME)}"


def clicked(run, want, seconds=4):
    said = run(
        "(async () => { const button = document.querySelector(%s); if (!button) return 'no themes button';"
        " button.click(); for (let i = 0; i < 40 && !document.querySelector(%s); i++)"
        " await new Promise((done) => setTimeout(done, 50));"
        " const choice = document.querySelector(%s); if (!choice) return 'no choice in the picker';"
        " choice.click(); return 'pressed' })()"
        % (json.dumps(THEMES), json.dumps(PICKER), json.dumps(mode(want)))
    )
    if said != "pressed":
        return said
    switched = waited(run, f"{SCHEME} === {json.dumps(want)}", seconds)
    run(CLOSE)
    if not waited(run, GONE, seconds):
        return "Escape left the picker open"
    return "switched" if switched else f"{NAMES[want]} in the picker left the app {run(SCHEME)}"
