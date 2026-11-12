# Branches

- Pull requests target `unstable`.
- Nothing goes onto `main` directly: no pushes, no merges of fix or feature PRs. `main` only moves from `unstable` when the owner promotes it.

# Code comments and documentation

- The code documents itself.
- No comments in code: no line, block or doc comments, in any language or file (TypeScript, Svelte, Rust, CSS, scripts, config), and none added when editing existing code. Say what code does through names and structure. The `orden/no-comments` lint rule enforces this.
- No documentation files: no `docs/` folder, no Markdown notes, no design specs or plans.
- Do not touch `README.md`.
