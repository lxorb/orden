# Bug burn-down

Started 2026-10-16 on `claude/gracious-euler-7rkkyk`.

## Method

- Baseline: full test suite (`pnpm test`), typecheck (`pnpm check`) and lint
  (`pnpm lint`) on Node 24, the version `.node-version` names.
- Audit: a read-only pass over the highest-risk areas, each finding traced to a
  concrete input before it was kept: the sync Worker, the Tauri backend's path
  judges, markdown rendering and the trust rule, sync-core / rooms / chats /
  online, the workspace store, bases and the editor's commands, and the
  machine service, the clipper, the CLI and CI.
- Each bug: reproduced, root cause named, regression test where possible, fix,
  then the package's tests re-run.

Severity: **Critical** - cross-user exposure, code execution or broad silent
data loss. **High** - data loss or a security hole on a specific path.
**Medium** - wrong behaviour in normal use. **Low** - cosmetic or a rare edge.

## Summary

| Severity | Found | Fixed | Open |
| --- | --: | --: | --: |
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 0 | 0 | 0 |
| Low | 0 | 0 | 0 |

## Bugs

_Filled in as the audit reports._
