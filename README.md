# Claude Prompt Nav

Jump between your own prompts in the Claude Code chat panel in VS Code.

A strip of thin lines sits at the left edge of the chat, one per prompt you sent. Click it to open a searchable list; pick a prompt and the chat scrolls to it.

- **Click the strip** to open the list. The current position is marked.
- **Type** to filter. **↑ / ↓** select, **Enter** jumps, **Home / End** go to the first / last match, **Esc** closes.
- **Hover or select a row** to read the whole prompt in a flyout beside the list.
- **Alt+↑ / Alt+↓** jump to the previous / next prompt without opening the list.
- **The round swatch** in the list header sets the accent colour (theme default, presets, or custom). It's remembered.

Only prompts you typed are listed. Task notifications, agent messages, notices, image-only messages and bare slash commands are left out.

## Install

Requirements: VS Code 1.90 or later with the **Claude Code** extension (2.1.299 or later) installed.

1. Get `claude-prompt-nav-<version>.vsix` (from the Releases page, or from whoever shared it with you).
2. Install it, either way:
   - In VS Code: **Extensions** view → `···` menu → **Install from VSIX…**
   - Or in a terminal: `code --install-extension claude-prompt-nav-<version>.vsix`
3. Run **Developer: Reload Window** (Command Palette). On startup the extension applies itself to Claude Code and shows a notification with a **Reload Window** button. Click it.
4. Open a Claude Code chat with a few prompts in it. The strip appears at the left edge.

If the strip doesn't appear, run **Claude Prompt Nav: Re-apply to Claude Code** from the Command Palette and reload.

## How it works, and why you should know

The Claude Code panel gives extensions no way to scroll its chat. This extension works by appending a small script (`prompt-nav.js`) to the Claude Code extension's own chat bundle (`webview/index.js`), between two marker comments. The script reads the chat's DOM and scrolls it. Nothing leaves the webview; there is no network access and no telemetry.

**This is not supported by Anthropic.** Each Claude Code update replaces the bundle, so this extension watches for updates and re-applies itself, then offers a reload. If Anthropic changes the chat's internals, the strip simply disappears until this extension is updated; the chat itself is unaffected.

An untouched copy of the bundle is kept beside it as `index.js.prompt-nav.orig`. Anthropic is tracking the underlying request in [anthropics/claude-code#70678](https://github.com/anthropics/claude-code/issues/70678) and [#105693](https://github.com/anthropics/claude-code/issues/105693); if either ships, retire this.

Known limits:
- Remote development (SSH, WSL, containers) is untested; the script has to reach the Claude Code bundle on the machine that draws the chat.
- The Claude Desktop app's Code tab is not covered.

## Uninstall

Command Palette → **Claude Prompt Nav: Remove from Claude Code**, reload, then uninstall the extension as usual. Reinstalling or updating Claude Code also restores its original bundle.

## Files

| File | Role |
| --- | --- |
| `prompt-nav.js` | The navigator. Runs inside the chat webview. |
| `patch.js` | Appends `prompt-nav.js` to every installed Claude Code bundle. Idempotent; also a CLI: `node patch.js [--check \| --undo \| --root DIR]`. |
| `extension.js` | The VS Code extension: runs `patch.js` on startup and when the extensions folder changes, with a reload prompt; commands to re-apply or remove. |

## Build from source

```bash
npm run package      # npx @vscode/vsce package → claude-prompt-nav-<version>.vsix
npm run apply        # node patch.js, for a local install without the extension
```

Needs Node 18+. No dependencies.

## Release a new version

1. Bump `version` in `package.json` (and `nav.version` near the top of `prompt-nav.js`), and add a `CHANGELOG.md` entry.
2. `npm run package` to build `claude-prompt-nav-<version>.vsix`.
3. Commit, tag `v<version>`, push `main` and the tag.
4. `gh release create v<version> claude-prompt-nav-<version>.vsix --title "Claude Prompt Nav <version>" --notes "..."`.

Coworkers who installed an earlier VSIX install the new one over it the same way.

## Selectors the script relies on

The chat's class names end in a per-build hash (`userMessageContainer_07S1Yg`), so the script matches prefixes: `messagesContainer_` (the scroll element), `turn_`, `userMessageContainer_`, `userMessage_`, `stickyHeader_`, `userMessageAttachments_`. Your own messages carry `aria-label="You"`. If a Claude Code update renames these, update the prefixes in `prompt-nav.js`.

## License

MIT.
