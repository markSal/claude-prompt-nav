# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.9.0] - 2026-10-31

### Added
- A Copy button in the preview copies the whole prompt, for reusing it. A header above the text names the prompt (number and time) and holds the button, so it stays put while a long prompt scrolls.

### Fixed
- A long prompt's text ended in "Show more" (the chat's expand button), in the preview, in search and in what Copy copied. The chat's buttons are now left out of a prompt's words.

## [0.8.0] - 2026-10-31

### Added
- A warning when a Claude Code update renames the chat class names the navigator finds prompts by, instead of the strip silently disappearing. The extension checks the install's stylesheet on start and after updates, and warns once per Claude Code version; `node patch.js` prints the same warning.

## [0.7.0] - 2026-10-31

### Added
- Alt+P opens and closes the list from the keyboard while the chat panel has focus.

### Changed
- Closing the list puts the focus back where it was, so the chat's input keeps its caret.

## [0.6.0] - 2026-10-31

### Added
- Search matches are highlighted in the preview, and the preview scrolls to the first one, so a prompt that matched past its first line shows why.

## [0.5.5] - 2026-10-31

### Changed
- The preview shows a prompt's whole text instead of its first 12 lines and 1,200 characters. A long prompt scrolls inside the preview, by mouse wheel, touchpad, scrollbar or Page Up/Down, without scrolling the chat; it starts at the top for each prompt.

## [0.5.4] - 2026-10-31

### Fixed
- The number vanished on a selected row that was also the current position: the position rule painted it in the accent colour, on the accent background. The selected row's number and time now use the accent's contrast colour (black or white) in every case.

## [0.5.3] - 2026-10-31

### Changed
- Collecting prompts is rate-limited: it waits for the chat to settle and never runs more often than every 800 ms while a reply streams, with a runaway guard that backs off to 3 s and warns once if it ever fires more than 15 times in ten seconds.
- The chat's scroll element is found once and reused while it stays on screen, instead of being searched for across the whole document on every pass; a hidden chat keeps its list and is re-read when it shows again.
- Timestamp formatting is cached per message.

## [0.5.2] - 2026-10-31

### Changed
- The custom colour picker applies its colour after the drag rests for 80 ms instead of on every movement, so the list is not repainted mid-drag.

## [0.5.1] - 2026-10-31

### Fixed
- The custom colour picker crawled while dragging: the accent was set on the document root, so every tick restyled the whole chat, and the text colour was worked out through a style lookup. The accent now lives on the navigator alone (the flashed message gets it inline for the moment), the text colour comes straight from the hex, changes apply once per frame, and the choice is saved when the picker closes.

## [0.5.0] - 2026-10-31

### Added
- One accent colour for everything that marks a prompt: the strip's active bar, the selected row, the preview border, the search focus ring and the flash on the message jumped to. It defaults to the theme's list-selection colour, so it matches the chat out of the box. A swatch in the list header opens a palette: the theme colour, seven theme-derived presets, or a custom picker. The choice is kept across reloads, and the selected row's text switches between black and white to stay readable on the chosen colour.

### Fixed
- Image-only messages no longer appear as "image.png" rows: attachment chips are left out when a message's words are read, which also cleans the first line of a message sent with a screenshot.

## [0.4.3] - 2026-10-31

### Changed
- The preview flyout has an accent border (the selected row's colour) and a deeper shadow.
- While the list is open, the chat behind it is dimmed toward the editor background and blurred 2 px, so the list and preview stand off it in any theme. A click on the dimmed chat closes the list without reaching what is underneath.

## [0.4.2] - 2026-10-31

### Fixed
- Bouncing while hovering between rows: the preview lived inside the list panel, so showing it changed the panel's height, which could shift the rows under a moving pointer and re-trigger itself. The preview is now a flyout beside the list (below it when there is no room) that takes no space, and the pointer previews only after a 120 ms rest; keyboard selection still previews at once.

## [0.4.1] - 2026-10-31

### Fixed
- A redraw loop: the navigator's own redraws re-triggered the chat observer every 200 ms, forcing layout on every message while the chat streamed. Its own changes are ignored now, and the list is redrawn only when the prompts changed.
- Arrow keys fighting the mouse: the pointer selects a row only when it actually moves, and a key press takes priority for a moment, so the selection no longer snaps back to the row under a resting pointer.
- The mouse wheel over the strip scrolls the chat instead of doing nothing.

## [0.4.0] - 2026-10-31

### Changed
- Rows never change height. The selected prompt's whole text shows in a preview under the list that animates open and shut, instead of expanding the row under the pointer.
- While open, the list is pinned by its top edge and only grows downward, and never past the bottom of the window.
- Keys are handled while the list is open whoever has the focus, so arrow keys, Enter and Esc work even if the chat moves the focus; typing goes to the search box.
- Clicks and presses inside the navigator are kept from the chat, and a click is resolved by the row under the pointer, so one click always jumps.

## [0.3.1] - 2026-10-31

### Changed
- Opening and closing the list is a smooth transition: the strip fades and slides out as the list fades and grows in from the edge, with an ease-out curve, reversed faster on close. Off under "reduce motion".

## [0.3.0] - 2026-10-31

### Added
- Keyboard navigation in the open list: Up/Down select a prompt (wrapping, skipping filtered-out rows), Enter jumps to it, Home/End go to the first/last match. The selection starts on your current position, follows the mouse, and shows the selected prompt's full text.

## [0.2.0] - 2026-10-31

### Added
- Search box in the list, filtering as you type; Enter jumps to the first match.
- Each prompt's time, taken from the panel's own timestamp.
- Tooltip with the first line when hovering a line in the strip.

### Changed
- The list opens on a click on the strip, not on hover, and closes on a row click, Esc or a click elsewhere.
- Only your own prompts are listed, using the panel's "You" label: task notifications, agent hand-backs, notices, image-only messages and bare slash commands are left out.
- The whole prompt shows on hover whenever the row is truncated, not only for multi-line prompts.
- Narrower strip that stays in the chat's left gutter.
- Styled from the panel's own design tokens (menu background, input border, radii, list hover, chat font size).

## [0.1.0] - 2026-10-31

### Added
- `prompt-nav.js`: stacked-lines strip at the left edge of the Claude Code chat; hover for the prompt list with full text, click to jump, Alt+Up / Alt+Down to step between prompts. Follows the VS Code theme through its CSS variables.
- `patch.js`: idempotent patcher and CLI (`--check`, `--undo`, `--root`) that appends the script to each installed Claude Code extension's `webview/index.js` and keeps an untouched backup.
- Companion extension: re-applies the patch on VS Code start and when the extensions folder changes, with a reload prompt; commands to re-apply or remove.
