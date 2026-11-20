import json
import os
import pathlib

results = pathlib.Path("apps/desktop/test/e2e/shots/results.json")
failed = []
if results.exists():
    drives = json.loads(results.read_text(encoding="utf-8"))["drives"]
    failed += [one["drive"] for one in drives if one["status"] not in ("pass", "flaky", "known", "skipped")]
steps = json.loads(os.environ.get("STEPS") or "{}")
failed += [f"scripts/{name}.py" for name, step in steps.items() if (name.endswith("-e2e") or name.endswith("-drive")) and step.get("outcome") == "failure"]
if not failed and steps.get("run-all", {}).get("outcome") == "failure":
    failed.append("run-all, which wrote no results")
if not failed and not results.exists() and not steps:
    failed.append("the drives wrote no results")
print("names=" + ", ".join(failed))
