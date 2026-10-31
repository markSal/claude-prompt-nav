# Future improvements

## Make it unnecessary
- Upvote and add findings to [anthropics/claude-code#105693](https://github.com/anthropics/claude-code/issues/105693) (VS Code conversation outline) and [#70678](https://github.com/anthropics/claude-code/issues/70678). The panel's wire protocol has no transcript-scroll target, which is the blocker for a mod-based version. If Anthropic ships either, retire this project.

## Navigator
- Setting for the side (`left` / `right`) and for hiding the strip until the mouse nears the edge.
- Show Claude's final answer under each prompt in the list (what #105693 asks for).
- Flag turns that ended with a question to you.
- Scroll the list so the active row stays in view in very long sessions.

## Patcher
- Detect a renamed class prefix after a Claude Code update and show a one-line notice instead of silently drawing nothing.
- Support the Claude Desktop app's Code tab if it keeps its webview bundle on disk the same way.

## Completed improvements
- [x] Strip, list, hover text, click-to-jump, Alt+Up/Down (0.1.0)
- [x] Idempotent patcher with backup and `--undo` (0.1.0)
- [x] Companion extension that re-applies after updates (0.1.0)
