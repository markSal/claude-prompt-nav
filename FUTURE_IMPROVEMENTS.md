# Future improvements

## Make it unnecessary
- Upvote and add findings to [anthropics/claude-code#105693](https://github.com/anthropics/claude-code/issues/105693) (VS Code conversation outline) and [#70678](https://github.com/anthropics/claude-code/issues/70678). The panel's wire protocol has no transcript-scroll target, which is the blocker for a mod-based version. If Anthropic ships either, retire this project.

## Navigator
- Setting for the side (`left` / `right`) and for hiding the strip until the mouse nears the edge.
- Show Claude's final answer under each prompt in the list (what #105693 asks for).
- Flag turns that ended with a question to you.

## Patcher
- Support the Claude Desktop app's Code tab if it keeps its webview bundle on disk the same way.

## Completed improvements
- [x] Strip, list, click-to-jump, Alt+Up/Down (0.1.0)
- [x] Idempotent patcher with backup and `--undo` (0.1.0)
- [x] Companion extension that re-applies after updates (0.1.0)
- [x] Search, timestamps, click-to-open, only your own prompts listed (0.2.0)
- [x] Keyboard selection: Up/Down, Enter, Home/End (0.3.0)
- [x] Smooth open/close transition (0.3.1)
- [x] Preview flyout, list grows downward only, one-click jumps (0.4.0–0.4.2)
- [x] Dimmed, blurred chat behind the open list (0.4.3)
- [x] Configurable accent colour with presets and custom picker (0.5.0–0.5.2)
- [x] Image-only messages left out (0.5.0)
- [x] Performance audit: rate-limited collecting, runaway guard, no document-wide restyles (0.4.1, 0.5.1, 0.5.3)
- [x] Active row kept in view when the list opens (0.4.0)
- [x] Published on GitHub with a VSIX release (0.5.4)
- [x] Preview shows the whole prompt and scrolls (0.5.5)
- [x] Search matches highlighted in the preview (0.6.0)
- [x] Alt+P opens the list from the keyboard (0.7.0)
- [x] Warning when a Claude Code update renames the chat's class names (0.8.0)
