/*!
 * prompt-nav — a prompt navigator for the Claude Code VS Code chat panel.
 *
 * Appended to the Claude Code extension's webview/index.js by patch.js. Draws
 * a strip of stacked lines at the edge of the chat, one per prompt you sent.
 * Click the strip to open the list: search it, move with the arrow keys, and
 * press Enter or click to jump to a prompt. Alt+Up / Alt+Down step between
 * prompts without opening the list.
 *
 * It only reads the chat's DOM and scrolls it. Nothing leaves the webview.
 * Styling uses the panel's own design tokens (--app-*, --corner-radius-*,
 * --vscode-chat-font-size) so it follows the theme like the rest of the chat.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__claudePromptNav) return;
  const nav = (window.__claudePromptNav = { version: '0.9.0', stats: { collects: 0, renders: 0 } });

  const SIDE = 'left'; // 'left' or 'right'
  const OPEN_KEY = 'KeyP'; // Alt + this key (a KeyboardEvent.code) opens or closes the list
  const MAX_BARS = 40; // bars in the collapsed strip; the list always shows all
  const TOP_GAP = 8; // px left above a message after a jump
  const CLOSE_MS = 120; // the close transition, matched in the CSS below

  // The accent colours everything that marks a prompt: the strip's active bar,
  // the selected row, the preview's border, the flash on the message jumped
  // to. By default it is the theme's list-selection colour, the one the panel
  // paints a chosen row with; a pick from the palette is kept across reloads.
  const ACCENT_KEY = 'claudePromptNav.accent';
  const THEME_ACCENT =
    'var(--app-list-active-background,var(--vscode-list-activeSelectionBackground,var(--vscode-focusBorder,#3794ff)))';
  const THEME_ACCENT_FG =
    'var(--app-list-active-foreground,var(--vscode-list-activeSelectionForeground,#ffffff))';
  const PRESETS = [
    { name: 'Theme colour', value: '' },
    { name: 'Blue', value: 'var(--vscode-charts-blue,#3b82f6)' },
    { name: 'Cyan', value: 'var(--vscode-terminal-ansiCyan,#06b6d4)' },
    { name: 'Green', value: 'var(--vscode-charts-green,#22c55e)' },
    { name: 'Yellow', value: 'var(--vscode-charts-yellow,#eab308)' },
    { name: 'Orange', value: 'var(--vscode-charts-orange,#f97316)' },
    { name: 'Red', value: 'var(--vscode-charts-red,#ef4444)' },
    { name: 'Purple', value: 'var(--vscode-charts-purple,#a855f7)' },
  ];

  // The chat's class names end in a per-build hash (userMessage_07S1Yg), so
  // elements are matched by class-name prefix, never by the full name.
  const byPrefix = (prefix) => (el) => {
    if (!el || !el.classList) return false;
    for (const token of el.classList) if (token.startsWith(prefix)) return true;
    return false;
  };
  const isContainer = byPrefix('messagesContainer_');
  const isTurn = byPrefix('turn_');
  const isUserMessage = byPrefix('userMessageContainer_');
  const isBubble = byPrefix('userMessage_');
  const isSticky = byPrefix('stickyHeader_');
  const query = (root, prefix, test) =>
    Array.from(root.querySelectorAll(`[class*="${prefix}"]`)).filter(test);

  const state = {
    container: null,
    entries: [], // { el, turn, sticky, text, full, line, multiline, time }
    active: -1, // the prompt at the top of the chat's viewport
    selected: -1, // the row the keyboard acts on while the list is open
    query: '',
    open: false,
    lastCollect: -Infinity,
    accent: '', // '' for the theme's colour, else a CSS colour or var()
    paletteOpen: false,
    unpin: 0,
    returnFocus: null,
    mouseX: -1, // where the pointer last was over the list
    mouseY: -1,
    keyAt: 0, // when a key last moved the selection; the pointer yields for a moment
    root: null,
    strip: null,
    panel: null,
    search: null,
    list: null,
    count: null,
    preview: null,
    previewBody: null,
    previewInfo: null,
    copyButton: null,
    copiedTimer: 0,
    previewTimer: 0,
    previewKey: '',
    scrim: null,
    swatch: null,
    palette: null,
    colorInput: null,
    probe: null,
    scrollRaf: 0,
  };

  // ---- CSS, from the panel's own tokens ---------------------------------

  const css = `
#claude-prompt-nav{position:fixed;top:50%;left:0;transform:translateY(-50%);z-index:1000;
  display:grid;align-items:center;justify-items:start;pointer-events:none;
  font-family:var(--vscode-font-family);font-size:var(--vscode-chat-font-size,13px);
  color:var(--app-primary-foreground,var(--vscode-foreground));
  --pn-accent:${THEME_ACCENT};--pn-accent-fg:${THEME_ACCENT_FG};
  --pn-muted:var(--app-secondary-foreground,var(--vscode-descriptionForeground,#8b949e));
  --pn-border:var(--app-input-border,var(--vscode-widget-border,rgba(128,128,128,.35)));
  --pn-small:calc(var(--vscode-chat-font-size,13px) - 1px);
  --pn-ease:cubic-bezier(.2,.8,.2,1);--pn-slide:-8px;--pn-max:72vh}
#claude-prompt-nav.pn-right{left:auto;right:0;justify-items:end;--pn-slide:8px}
#claude-prompt-nav.pn-empty{display:none}
/* While open the root is pinned by its top (set from script), so the list only
   ever grows downward: nothing above the pointer moves. */
#claude-prompt-nav.pn-open{align-items:start}
/* The strip and the list share one grid cell, so one fades out where the
   other fades in. The root takes no pointer events of its own; each child does. */
#claude-prompt-nav .pn-strip{grid-area:1/1;display:flex;flex-direction:column;align-items:flex-start;gap:5px;
  padding:12px 8px 12px 5px;cursor:pointer;pointer-events:auto;
  transition:opacity .14s var(--pn-ease),transform .14s var(--pn-ease)}
#claude-prompt-nav.pn-right .pn-strip{align-items:flex-end;padding:12px 5px 12px 8px}
#claude-prompt-nav .pn-bar{height:2px;border-radius:1px;background:var(--pn-muted);opacity:.38;
  transition:opacity .15s,background-color .15s}
#claude-prompt-nav .pn-bar.pn-active{background:var(--pn-accent);opacity:1}
#claude-prompt-nav .pn-strip:hover .pn-bar{opacity:.7}
#claude-prompt-nav .pn-strip:hover .pn-bar.pn-active{opacity:1}
#claude-prompt-nav .pn-panel{grid-area:1/1;position:relative;display:flex;flex-direction:column;width:min(360px,78vw);
  max-height:var(--pn-max);box-sizing:border-box;margin:0 8px;
  background:var(--app-menu-background,var(--vscode-menu-background,var(--vscode-editorWidget-background)));
  border:1px solid var(--pn-border);border-radius:var(--corner-radius-large,8px);padding:4px;
  box-shadow:0 2px 8px var(--vscode-widget-shadow,rgba(0,0,0,.36));
  opacity:0;visibility:hidden;pointer-events:none;transform:translateX(var(--pn-slide)) scale(.98);
  transform-origin:left top;
  transition:opacity .12s var(--pn-ease),transform .12s var(--pn-ease),visibility 0s linear .12s}
#claude-prompt-nav.pn-right .pn-panel{transform-origin:right top}
#claude-prompt-nav.pn-open .pn-strip{opacity:0;transform:translateX(calc(var(--pn-slide) * -.75));pointer-events:none}
#claude-prompt-nav.pn-open .pn-panel{opacity:1;visibility:visible;pointer-events:auto;transform:none;
  transition:opacity .18s var(--pn-ease),transform .18s var(--pn-ease),visibility 0s}
#claude-prompt-nav .pn-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex:0 0 auto;
  padding:6px 8px 4px;color:var(--pn-muted);font-size:var(--pn-small)}
#claude-prompt-nav .pn-title{color:var(--app-primary-foreground,var(--vscode-foreground));font-weight:600;
  font-size:var(--vscode-chat-font-size,13px);margin-right:6px}
#claude-prompt-nav .pn-hint{white-space:nowrap;display:inline-flex;align-items:center;gap:3px}
#claude-prompt-nav .pn-hint kbd{font:inherit;padding:0 3px;border:1px solid var(--pn-border);
  border-radius:var(--corner-radius-small,4px);line-height:1.3}
/* The accent swatch opens a palette; the current colour wears a ring. */
#claude-prompt-nav .pn-swatch{width:14px;height:14px;margin-left:6px;padding:0;border-radius:50%;cursor:pointer;
  background:var(--pn-accent);border:1px solid var(--pn-border);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
#claude-prompt-nav .pn-swatch:hover{box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),0 0 0 2px var(--pn-border)}
#claude-prompt-nav .pn-palette{position:absolute;top:32px;right:8px;z-index:2;display:none;align-items:center;gap:7px;
  padding:8px;background:var(--app-menu-background,var(--vscode-menu-background,var(--vscode-editorWidget-background)));
  border:1px solid var(--pn-border);border-radius:var(--corner-radius-medium,6px);
  box-shadow:0 4px 14px var(--vscode-widget-shadow,rgba(0,0,0,.4))}
#claude-prompt-nav .pn-palette.pn-shown{display:flex}
#claude-prompt-nav .pn-chip{width:18px;height:18px;padding:0;border-radius:50%;cursor:pointer;border:1px solid var(--pn-border)}
#claude-prompt-nav .pn-chip:hover{transform:scale(1.12)}
#claude-prompt-nav .pn-chip.pn-current{box-shadow:0 0 0 2px var(--app-menu-background,var(--vscode-menu-background)),
  0 0 0 3px var(--pn-accent)}
#claude-prompt-nav .pn-chip.pn-custom{background:conic-gradient(#f43f5e,#f59e0b,#84cc16,#06b6d4,#6366f1,#d946ef,#f43f5e)}
#claude-prompt-nav .pn-color,#claude-prompt-nav .pn-probe{position:absolute;width:0;height:0;opacity:0;pointer-events:none}
#claude-prompt-nav .pn-search{display:block;flex:0 0 auto;width:100%;box-sizing:border-box;margin:2px 0 6px;padding:4px 8px;
  font:inherit;color:var(--app-input-foreground,var(--vscode-input-foreground));
  background:var(--app-input-background,var(--vscode-input-background));border:1px solid var(--pn-border);
  border-radius:var(--corner-radius-small,4px);outline:none}
#claude-prompt-nav .pn-search::placeholder{color:var(--app-input-placeholder-foreground,var(--vscode-input-placeholderForeground))}
#claude-prompt-nav .pn-search:focus{border-color:var(--pn-accent)}
#claude-prompt-nav .pn-list{display:flex;flex-direction:column;gap:var(--app-list-gap,2px);flex:1 1 auto;min-height:0;overflow:auto}
#claude-prompt-nav .pn-none{padding:6px 8px 8px;color:var(--pn-muted);font-size:var(--pn-small)}
#claude-prompt-nav .pn-row{display:block;flex:0 0 auto;width:100%;text-align:left;background:none;border:0;margin:0;
  padding:var(--app-list-item-padding,4px 8px);border-radius:var(--app-list-border-radius,4px);
  color:inherit;font:inherit;cursor:pointer;line-height:1.4}
#claude-prompt-nav .pn-row[hidden]{display:none}
#claude-prompt-nav .pn-row:hover{background:var(--app-list-hover-background,var(--vscode-list-hoverBackground))}
#claude-prompt-nav .pn-row:focus-visible{outline:none}
#claude-prompt-nav .pn-row.pn-active{background:var(--vscode-list-inactiveSelectionBackground,rgba(128,128,128,.12))}
#claude-prompt-nav .pn-row.pn-selected,#claude-prompt-nav .pn-row.pn-selected:hover{
  background:var(--pn-accent);color:var(--pn-accent-fg)}
/* On the accent background the number and time take the accent's contrast
   colour, also when the row is the current position (whose rule below would
   otherwise paint the number in the accent itself and hide it). */
#claude-prompt-nav .pn-row.pn-selected .pn-num,#claude-prompt-nav .pn-row.pn-selected.pn-active .pn-num,
#claude-prompt-nav .pn-row.pn-selected .pn-time{color:var(--pn-accent-fg);opacity:.85}
#claude-prompt-nav .pn-line{display:flex;gap:8px;align-items:baseline;min-width:0}
#claude-prompt-nav .pn-num{flex:0 0 auto;min-width:1.5em;text-align:right;color:var(--pn-muted);
  font-variant-numeric:tabular-nums;font-size:.85em}
#claude-prompt-nav .pn-row.pn-active .pn-num{color:var(--pn-accent);font-weight:600}
#claude-prompt-nav .pn-text{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#claude-prompt-nav .pn-time{flex:0 0 auto;color:var(--pn-muted);font-size:.85em;line-height:16px;white-space:nowrap}
/* The selected prompt's whole text, in a flyout beside the list (below it when
   there is no room). It floats over the chat and takes no space, so nothing
   in the list ever moves when it shows or hides. A header names the prompt
   and holds its Copy button; below it a long prompt scrolls, by wheel,
   scrollbar or Page Up/Down, without scrolling the chat. */
#claude-prompt-nav .pn-preview{position:absolute;box-sizing:border-box;pointer-events:none;
  display:flex;flex-direction:column;max-height:min(50vh,var(--pn-max));overflow:hidden;
  background:var(--app-menu-background,var(--vscode-menu-background,var(--vscode-editorWidget-background)));
  border:1px solid var(--pn-accent);border-radius:var(--corner-radius-medium,6px);
  box-shadow:0 6px 20px var(--vscode-widget-shadow,rgba(0,0,0,.45));
  color:var(--app-primary-foreground,var(--vscode-foreground));font-size:var(--pn-small);line-height:1.45;
  opacity:0;visibility:hidden;transform:translateX(calc(var(--pn-slide) * -.5));
  transition:opacity .14s var(--pn-ease),transform .14s var(--pn-ease),visibility 0s linear .14s}
#claude-prompt-nav .pn-preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:0 0 auto;
  padding:3px 4px 3px 10px;border-bottom:1px solid var(--pn-border);color:var(--pn-muted);font-size:.92em}
#claude-prompt-nav .pn-copy{font:inherit;color:inherit;background:none;border:1px solid transparent;
  border-radius:var(--corner-radius-small,4px);padding:1px 8px;cursor:pointer}
#claude-prompt-nav .pn-copy:hover{color:var(--app-primary-foreground,var(--vscode-foreground));
  background:var(--app-list-hover-background,var(--vscode-list-hoverBackground));border-color:var(--pn-border)}
#claude-prompt-nav .pn-copy.pn-copied{color:var(--pn-accent)}
#claude-prompt-nav .pn-preview-body{position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
  padding:6px 10px 7px;white-space:pre-wrap;overflow-wrap:anywhere}
/* Search matches in the preview, tinted with the accent. */
#claude-prompt-nav .pn-hit{background:color-mix(in srgb,var(--pn-accent) 40%,transparent);color:inherit;
  border-radius:2px;box-shadow:0 0 0 1px color-mix(in srgb,var(--pn-accent) 70%,transparent)}
#claude-prompt-nav .pn-preview.pn-shown{opacity:1;visibility:visible;transform:none;pointer-events:auto;
  transition:opacity .14s var(--pn-ease),transform .14s var(--pn-ease),visibility 0s}
/* While the list is open the chat behind it is dimmed toward the editor
   background and softly blurred, so the list and the preview stand off it.
   A click on it closes the list and reaches nothing underneath. */
#claude-prompt-nav-scrim{position:fixed;inset:0;z-index:999;pointer-events:none;opacity:0;
  background:color-mix(in srgb,var(--vscode-editor-background,#1e1e1e) 45%,transparent);
  -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  transition:opacity .18s cubic-bezier(.2,.8,.2,1)}
#claude-prompt-nav-scrim.pn-shown{opacity:1;pointer-events:auto}
.pn-flash{animation:pn-flash 1.4s ease-out}
@keyframes pn-flash{0%{box-shadow:0 0 0 2px var(--pn-accent,${THEME_ACCENT})}100%{box-shadow:0 0 0 2px transparent}}
@media (prefers-reduced-motion:reduce){
  #claude-prompt-nav .pn-strip,#claude-prompt-nav .pn-panel,#claude-prompt-nav .pn-bar,#claude-prompt-nav .pn-preview,
  #claude-prompt-nav-scrim{transition:none}}
`;

  // ---- DOM helpers -------------------------------------------------------

  const visible = (el) => el.getClientRects().length > 0;

  function findContainer() {
    const all = query(document, 'messagesContainer_', isContainer).filter(visible);
    if (!all.length) return null;
    // Several sessions can be mounted; the one on screen is the largest.
    return all.reduce(
      (best, el) => {
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        return area > best.area ? { el, area } : best;
      },
      { el: all[0], area: -1 },
    ).el;
  }

  function closestTurn(el, stop) {
    for (let node = el; node && node !== stop; node = node.parentElement) {
      if (isTurn(node)) return node;
    }
    return null;
  }

  const clean = (text) => text.replace(/ /g, ' ').replace(/\r/g, '').trim();

  const firstLine = (text) => {
    const line = text.split('\n').find((l) => l.trim()) || '';
    return line.trim().replace(/\s+/g, ' ');
  };

  // The panel's own timestamp on the message, formatted the way it does.
  // Formatting is cached by the stamp's value: it never changes for a message.
  const timeCache = new Map();
  function promptTime(message) {
    const stamp = message.querySelector('time[datetime]');
    if (!stamp) return '';
    const iso = stamp.getAttribute('datetime');
    let text = timeCache.get(iso);
    if (text === undefined) {
      const at = new Date(iso);
      text = Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      timeCache.set(iso, text);
    }
    return text;
  }

  // Attachment chips (image.png and the like) are not words the person typed.
  const ATTACHMENT = '[class*="ttachment"], img, picture, video';
  // Nor are the chat's own buttons: a long message carries "Show more" and
  // "Show less", kept in the markup (visually hidden) even when unused.
  const NOT_WORDS = `${ATTACHMENT}, button`;

  // The words of a node without its attachment chips and buttons. innerText
  // keeps a prompt's line breaks, so it is used wherever nothing has to be
  // left out.
  function wordsOf(node) {
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1 || node.matches(NOT_WORDS)) return '';
    if (!node.querySelector(NOT_WORDS)) return node.innerText || node.textContent || '';
    return Array.from(node.childNodes).map(wordsOf).join('\n');
  }

  // innerText forces a layout, so a bubble's words are read once and again
  // only when its text changed.
  const textCache = new WeakMap();
  function bubbleText(bubble) {
    const key = bubble.textContent || '';
    const cached = textCache.get(bubble);
    if (cached && cached.key === key) return cached.text;
    const text = wordsOf(bubble);
    textCache.set(bubble, { key, text });
    return text;
  }

  // A row is one of the person's own prompts when the panel labels it "You"
  // (notifications, agent hand-backs and notices get other labels), it has
  // typed words once attachment chips are left out (an image-only message has
  // none), and it is not a bare slash command such as "/model fable".
  function ownPrompt(message) {
    const label = message.getAttribute('aria-label') || '';
    if (label && !/^You\b/.test(label)) return null;
    const bubbles = query(message, 'userMessage_', isBubble);
    if (!bubbles.length) return null;
    const text = clean(bubbles.map(bubbleText).join('\n'));
    if (!text) return null;
    // A bare file name beside a picture is a chip the markup did not label.
    if (/^[\w.-]+\.(png|jpe?g|gif|webp|bmp|svg|pdf)(\s+\d+\s*[x×]\s*\d+)?$/i.test(text) && message.querySelector(ATTACHMENT)) {
      return null;
    }
    if (text.startsWith('/') && !text.includes('\n') && text.length < 80) return null;
    return text;
  }

  // ---- Accent colour ----------------------------------------------------

  function loadAccent() {
    try {
      return localStorage.getItem(ACCENT_KEY) || '';
    } catch {
      return '';
    }
  }

  function saveAccent(value) {
    try {
      if (value) localStorage.setItem(ACCENT_KEY, value);
      else localStorage.removeItem(ACCENT_KEY);
    } catch {
      // Storage may be unavailable; the colour then lasts for this session.
    }
  }

  // The colour a CSS value resolves to on this theme, as [r, g, b].
  function resolveColor(value) {
    state.probe.style.color = value;
    const found = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(state.probe).color);
    return found ? [Number(found[1]), Number(found[2]), Number(found[3])] : null;
  }

  // A "#rrggbb" value read without touching styles; null for anything else.
  function hexToRgb(value) {
    const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value.trim());
    return found ? found.slice(1).map((h) => parseInt(h, 16)) : null;
  }

  // Black or white, whichever reads better on the accent (WCAG luminance).
  function textOn(value) {
    const rgb = hexToRgb(value) || resolveColor(value);
    if (!rgb) return '#ffffff';
    const [r, g, b] = rgb.map((n) => {
      const c = n / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff';
  }

  const toHex = (rgb) => '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('');

  // The accent is set on the navigator's root alone, never on the document:
  // a variable changed on the document makes the browser restyle the whole
  // chat, which made dragging in the colour picker crawl.
  function applyAccent(value) {
    state.accent = value;
    const style = state.root.style;
    if (value) {
      style.setProperty('--pn-accent', value);
      style.setProperty('--pn-accent-fg', textOn(value));
    } else {
      style.removeProperty('--pn-accent');
      style.removeProperty('--pn-accent-fg');
    }
    for (const chip of state.palette.children) {
      const current = chip.classList.contains('pn-custom')
        ? Boolean(value) && !PRESETS.some((p) => p.value === value)
        : chip.dataset.value === value;
      chip.classList.toggle('pn-current', current);
    }
  }

  function setPalette(open) {
    state.paletteOpen = open;
    state.palette.classList.toggle('pn-shown', open);
  }

  // ---- Collecting prompts -----------------------------------------------

  function collect() {
    nav.stats.collects++;
    const now = performance.now();
    state.lastCollect = now;
    // A runaway guard: more than 15 passes in ten seconds means something is
    // re-triggering this, so slow down and say so once, rather than spin.
    recentCollects.push(now);
    while (recentCollects.length && now - recentCollects[0] > 10000) recentCollects.shift();
    if (recentCollects.length > 15 && now > backoffUntil) {
      backoffUntil = now + 30000;
      console.warn('prompt-nav: collecting too often; backing off for 30 s');
    }

    // The scroll element is found once and kept while it stays on screen; a
    // session switch mounts another, and a hidden chat keeps the list as is.
    let container = state.container;
    if (!container || !container.isConnected || !visible(container)) container = findContainer();
    if (!container) return;
    if (container !== state.container) attachScroll(container);

    const entries = [];
    {
      let messages = query(container, 'userMessageContainer_', isUserMessage);
      // Real transcript rows carry data-transcript-message; keep only those
      // when the build marks them, else take every user row.
      const marked = messages.filter((m) => m.hasAttribute('data-transcript-message'));
      if (marked.length) messages = marked;
      for (const el of messages) {
        const full = ownPrompt(el);
        if (!full) continue;
        entries.push({
          el,
          turn: closestTurn(el, container),
          sticky: isSticky(el),
          full,
          line: firstLine(full),
          multiline: full.includes('\n'),
          time: promptTime(el),
        });
      }
    }
    // Redraw only when the prompts changed; the chat mutates constantly while
    // a reply streams, and redrawing then would churn the list for nothing.
    const same =
      entries.length === state.entries.length &&
      entries.every((entry, i) => {
        const prev = state.entries[i];
        return (
          prev.el === entry.el &&
          prev.turn === entry.turn &&
          prev.sticky === entry.sticky &&
          prev.full === entry.full &&
          prev.time === entry.time
        );
      });
    state.entries = entries;
    if (!same) {
      state.active = Math.min(state.active, entries.length - 1);
      state.selected = Math.min(state.selected, entries.length - 1);
      render();
      nav.stats.renders++;
    }
    updateActive(true);
  }

  // The element whose top is the prompt's natural place: a sticky prompt's
  // own rect is where it is stuck, so its turn stands in for it.
  const anchorOf = (entry) => (entry.sticky && entry.turn) || entry.el;

  function updateActive(force) {
    const c = state.container;
    if (!c || !state.entries.length) return;
    const cTop = c.getBoundingClientRect().top;
    let active = 0;
    state.entries.forEach((entry, i) => {
      const top = anchorOf(entry).getBoundingClientRect().top - cTop;
      if (top <= TOP_GAP + 40) active = i;
    });
    if (active !== state.active || force) {
      state.active = active;
      paintActive();
    }
  }

  function jumpTo(index) {
    const entry = state.entries[index];
    const c = state.container;
    if (!entry || !c) return;
    const top =
      anchorOf(entry).getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - TOP_GAP;
    c.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    // The accent lives on the navigator; the message gets it for the flash.
    if (state.accent) entry.el.style.setProperty('--pn-accent', state.accent);
    entry.el.classList.remove('pn-flash');
    void entry.el.offsetWidth; // restart the animation
    entry.el.classList.add('pn-flash');
    setTimeout(() => {
      entry.el.classList.remove('pn-flash');
      entry.el.style.removeProperty('--pn-accent');
    }, 1500);
    state.active = index;
    paintActive();
  }

  // ---- Rendering ---------------------------------------------------------

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function ensureRoot() {
    if (state.root && document.body.contains(state.root)) return;
    if (!document.getElementById('claude-prompt-nav-style')) {
      const style = el('style');
      style.id = 'claude-prompt-nav-style';
      style.textContent = css;
      document.head.appendChild(style);
    }
    const root = el('nav', `pn-${SIDE} pn-empty`);
    root.id = 'claude-prompt-nav';
    root.setAttribute('aria-label', 'Your prompts');

    const strip = el('div', 'pn-strip');
    strip.setAttribute('aria-hidden', 'true');
    strip.title = 'Your prompts: click or press Alt+P to open the list';
    // The wheel over the strip scrolls the chat, as it would without the strip.
    strip.addEventListener(
      'wheel',
      (event) => {
        if (!state.container) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.container.clientHeight : 1;
        state.container.scrollBy({ top: event.deltaY * unit, left: 0 });
      },
      { passive: false },
    );

    const panel = el('div', 'pn-panel');
    const head = el('div', 'pn-head');
    const titleWrap = el('span');
    const count = el('span');
    titleWrap.append(el('span', 'pn-title', 'Prompts'), count);
    const hint = el('span', 'pn-hint');
    hint.title =
      'Up and Down select a prompt, Enter jumps to it, Esc closes.\nAlt+Up and Alt+Down step between prompts without opening the list.';
    hint.append(el('kbd', '', '↑'), el('kbd', '', '↓'), ' ', el('kbd', '', 'Enter'), ' ', el('kbd', '', 'Esc'));
    const swatch = el('button', 'pn-swatch');
    swatch.type = 'button';
    swatch.title = 'Accent colour';
    swatch.setAttribute('aria-label', 'Accent colour');
    hint.append(swatch);
    head.append(titleWrap, hint);

    const palette = el('div', 'pn-palette');
    palette.setAttribute('role', 'group');
    palette.setAttribute('aria-label', 'Accent colour');
    for (const preset of PRESETS) {
      const chip = el('button', 'pn-chip');
      chip.type = 'button';
      chip.title = preset.name;
      chip.dataset.value = preset.value;
      chip.style.background = preset.value || THEME_ACCENT;
      palette.append(chip);
    }
    const custom = el('button', 'pn-chip pn-custom');
    custom.type = 'button';
    custom.title = 'Custom colour…';
    palette.append(custom);
    const colorInput = el('input', 'pn-color');
    colorInput.type = 'color';
    colorInput.tabIndex = -1;
    colorInput.setAttribute('aria-hidden', 'true');
    // While the picker is dragged it fires on every pixel. The colour is
    // applied once the drag rests for a moment, and saved when the pick is done.
    let colorTimer = 0;
    colorInput.addEventListener('input', () => {
      clearTimeout(colorTimer);
      colorTimer = setTimeout(() => applyAccent(colorInput.value), 80);
    });
    colorInput.addEventListener('change', () => {
      clearTimeout(colorTimer);
      applyAccent(colorInput.value);
      saveAccent(colorInput.value);
    });
    const probe = el('span', 'pn-probe');
    probe.setAttribute('aria-hidden', 'true');

    const search = el('input', 'pn-search');
    search.type = 'search';
    search.placeholder = 'Search prompts';
    search.setAttribute('aria-label', 'Search prompts');
    search.spellcheck = false;
    search.addEventListener('input', () => {
      state.query = search.value;
      applyFilter();
      if (state.open) updatePreview();
    });

    const list = el('div', 'pn-list');
    list.setAttribute('role', 'list');
    // The pointer selects the row under it only when it actually moves, as
    // VS Code's own lists do: the list scrolling under a resting pointer must
    // not pull the selection back, and a fresh key press takes priority.
    list.addEventListener('mousemove', (event) => {
      if (event.clientX === state.mouseX && event.clientY === state.mouseY) return;
      state.mouseX = event.clientX;
      state.mouseY = event.clientY;
      if (performance.now() - state.keyAt < 300) return;
      const row = event.target.closest('.pn-row');
      if (row && list.contains(row)) select(Number(row.dataset.index), false);
    });

    const preview = el('div', 'pn-preview');
    const previewInfo = el('span', 'pn-preview-info');
    const copyButton = el('button', 'pn-copy', 'Copy');
    copyButton.type = 'button';
    copyButton.tabIndex = -1; // like the rows: the search box keeps the focus
    copyButton.title = 'Copy this prompt';
    // Pressing it must not take the focus from the search box.
    copyButton.addEventListener('mousedown', (event) => event.preventDefault());
    const previewHead = el('div', 'pn-preview-head');
    previewHead.append(previewInfo, copyButton);
    const previewBody = el('div', 'pn-preview-body');
    previewBody.setAttribute('aria-hidden', 'true');
    preview.append(previewHead, previewBody);

    panel.append(head, search, list, preview, palette, colorInput, probe);
    root.append(strip, panel);
    const scrim = el('div');
    scrim.id = 'claude-prompt-nav-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    document.body.append(scrim, root);
    Object.assign(state, {
      root,
      strip,
      panel,
      search,
      list,
      count,
      preview,
      previewBody,
      previewInfo,
      copyButton,
      scrim,
      swatch,
      palette,
      colorInput,
      probe,
    });
    applyAccent(loadAccent());
  }

  // The list opens on a click on the strip or Alt+P, and closes on a row's
  // click, on Escape or Alt+P, or on a click anywhere else; hovering the
  // strip opens nothing. Closing hands the focus back to where it was, so
  // the chat's input keeps its caret.
  function setOpen(open) {
    if (!state.root || state.open === open) return;
    state.open = open;
    clearTimeout(state.unpin);
    if (open) {
      const was = document.activeElement;
      state.returnFocus = was && was !== document.body && !state.root.contains(was) ? was : null;
      // Pin the root where it is so the list grows downward only, and never
      // past the bottom of the window.
      const top = Math.max(8, state.root.getBoundingClientRect().top);
      state.root.style.top = `${top}px`;
      state.root.style.transform = 'none';
      state.root.style.setProperty('--pn-max', `min(72vh, calc(100vh - ${top + 12}px))`);
      state.root.classList.add('pn-open');
      state.scrim.classList.add('pn-shown');
      const current = state.entries[state.active] ? state.active : -1;
      const first = visibleRows()[0];
      select(current >= 0 ? current : first ? Number(first.dataset.index) : -1, true);
      state.search.focus();
      // The chat may move the focus after this click; take it back.
      setTimeout(() => state.open && state.search.focus(), 0);
    } else {
      state.root.classList.remove('pn-open');
      state.scrim.classList.remove('pn-shown');
      setPalette(false);
      clearTimeout(state.previewTimer);
      state.preview.classList.remove('pn-shown');
      state.previewKey = ''; // reopened, the preview starts over at its first match
      state.search.blur();
      const back = state.returnFocus;
      state.returnFocus = null;
      if (back && back.isConnected) back.focus({ preventScroll: true });
      state.unpin = setTimeout(() => {
        state.root.style.top = '';
        state.root.style.transform = '';
        state.root.style.removeProperty('--pn-max');
      }, CLOSE_MS + 30);
    }
  }

  function render() {
    ensureRoot();
    const { entries } = state;
    state.root.classList.toggle('pn-empty', entries.length === 0);

    const shownBars = entries.slice(Math.max(0, entries.length - MAX_BARS));
    const barOffset = entries.length - shownBars.length;
    state.strip.replaceChildren(
      ...shownBars.map((entry, i) => {
        const bar = el('div', 'pn-bar');
        bar.dataset.index = String(barOffset + i);
        bar.title = `${barOffset + i + 1}. ${entry.line}`;
        bar.style.width = `${6 + Math.min(8, Math.round(Math.log2(1 + entry.full.length)))}px`;
        return bar;
      }),
    );

    state.list.replaceChildren(
      ...entries.map((entry, i) => {
        const row = el('button', 'pn-row');
        row.type = 'button';
        row.tabIndex = -1; // the search box keeps the focus; keys are handled above
        row.dataset.index = String(i);
        row.setAttribute('role', 'listitem');
        const line = el('div', 'pn-line');
        line.append(el('span', 'pn-num', String(i + 1)), el('span', 'pn-text', entry.line));
        if (entry.time) line.append(el('span', 'pn-time', entry.time));
        row.append(line);
        return row;
      }),
    );
    applyFilter();
    paintActive();
    if (state.open) select(state.selected, false);
  }

  function applyFilter() {
    const needle = state.query.trim().toLowerCase();
    let shown = 0;
    for (const row of state.list.children) {
      if (!row.dataset.index) continue;
      const entry = state.entries[Number(row.dataset.index)];
      const match = !needle || entry.full.toLowerCase().includes(needle);
      row.hidden = !match;
      if (match) shown++;
    }
    const total = state.entries.length;
    state.count.textContent = needle
      ? `${shown} of ${total}`
      : total === 1
        ? '1 prompt'
        : `${total} prompts`;
    let none = state.list.querySelector('.pn-none');
    if (needle && shown === 0) {
      if (!none) state.list.append((none = el('div', 'pn-none')));
      none.textContent = `No prompts match “${state.query.trim()}”.`;
    } else if (none) {
      none.remove();
    }
    // A selection the filter hid moves to the first match left.
    if (state.open) {
      const rows = visibleRows();
      const kept = rows.some((row) => row.dataset.index === String(state.selected));
      if (!kept) select(rows.length ? Number(rows[0].dataset.index) : -1, true);
    }
  }

  function paintActive() {
    if (!state.root) return;
    const idx = String(state.active);
    for (const bar of state.strip.children) bar.classList.toggle('pn-active', bar.dataset.index === idx);
    for (const row of state.list.children) row.classList.toggle('pn-active', row.dataset.index === idx);
  }

  // ---- Selection in the open list ----------------------------------------

  const visibleRows = () => Array.from(state.list.children).filter((row) => row.dataset.index && !row.hidden);

  // `scroll` is true for the keyboard: the row is brought into view and the
  // preview shows at once. The pointer previews after a short rest, so a
  // sweep across the rows does not flash a preview for each.
  function select(index, scroll) {
    state.selected = index;
    let selectedRow = null;
    for (const row of state.list.children) {
      if (!row.dataset.index) continue;
      const on = row.dataset.index === String(index);
      row.classList.toggle('pn-selected', on);
      if (on) selectedRow = row;
    }
    if (selectedRow && scroll) revealRow(selectedRow);
    clearTimeout(state.previewTimer);
    if (scroll) updatePreview();
    else state.previewTimer = setTimeout(updatePreview, 120);
  }

  // Preview the whole prompt when its row cannot show it: several lines, or
  // a first line the row had to cut. Known only once drawn.
  function updatePreview() {
    const entry = state.entries[state.selected];
    const row = state.list.querySelector('.pn-row.pn-selected:not([hidden])');
    const text = row && row.querySelector('.pn-text');
    const cut = text && text.scrollWidth > text.clientWidth + 1;
    const show = Boolean(state.open && entry && row && (entry.multiline || cut));
    if (show) {
      const needle = state.query.trim().toLowerCase();
      const key = `${needle}\u0000${entry.full}`;
      const fresh = key !== state.previewKey;
      if (fresh) {
        state.previewKey = key;
        state.previewBody.replaceChildren(...highlight(entry.full, needle));
        state.previewInfo.textContent = [`Prompt ${state.selected + 1}`, entry.time].filter(Boolean).join(' · ');
        clearTimeout(state.copiedTimer);
        state.copyButton.textContent = 'Copy';
        state.copyButton.classList.remove('pn-copied');
      }
      placePreview(row);
      // A new prompt or search starts at the first match, a third of the way
      // down, or at the top when nothing is marked.
      if (fresh) {
        const body = state.previewBody;
        const hit = body.querySelector('.pn-hit');
        body.scrollTop = hit ? Math.max(0, hit.offsetTop - body.clientHeight / 3) : 0;
      }
    }
    state.preview.classList.toggle('pn-shown', show);
  }

  // The text as nodes, each case-insensitive match of the needle in a <mark>.
  // Built from text nodes, so nothing in a prompt is ever read as markup.
  function highlight(text, needle) {
    const lower = text.toLowerCase();
    // Lowercasing can change a string's length (İ, for one), which would
    // shift every index below; such a prompt shows unmarked.
    if (!needle || lower.length !== text.length) return [text];
    const nodes = [];
    let from = 0;
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
      if (at > from) nodes.push(text.slice(from, at));
      nodes.push(el('mark', 'pn-hit', text.slice(at, at + needle.length)));
      from = at + needle.length;
    }
    if (from < text.length) nodes.push(text.slice(from));
    return nodes;
  }

  // Beside the list, level with the row, kept inside the window; below the
  // list when the window leaves no room beside it.
  function placePreview(row) {
    const { panel, preview } = state;
    const pr = panel.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const gap = 6;
    const spaceRight = window.innerWidth - pr.right - gap - 8;
    const spaceLeft = pr.left - gap - 8;
    const beside = SIDE === 'left' ? spaceRight : spaceLeft;
    preview.style.left = preview.style.right = preview.style.top = preview.style.width = '';
    if (beside >= 200) {
      preview.style.width = `${Math.min(340, beside)}px`;
      if (SIDE === 'left') preview.style.left = `${pr.width + gap}px`;
      else preview.style.right = `${pr.width + gap}px`;
      const height = preview.offsetHeight;
      const wanted = rr.top - pr.top - 1;
      const maxTop = window.innerHeight - pr.top - height - 8;
      preview.style.top = `${Math.max(0, Math.min(wanted, maxTop))}px`;
    } else {
      preview.style.left = '0';
      preview.style.width = `${pr.width}px`;
      preview.style.top = `${pr.height + gap}px`;
    }
  }

  // The clipboard API where the webview allows it, else the older copy
  // command through a hidden text box. The button says which happened.
  async function copyPrompt(text) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const box = el('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(box);
      box.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      box.remove();
      if (state.open) state.search.focus();
    }
    const button = state.copyButton;
    button.textContent = ok ? 'Copied' : 'Copy failed';
    button.classList.toggle('pn-copied', ok);
    clearTimeout(state.copiedTimer);
    state.copiedTimer = setTimeout(() => {
      button.textContent = 'Copy';
      button.classList.remove('pn-copied');
    }, 1500);
  }

  // Scroll the list alone, never the chat behind it.
  function revealRow(row) {
    const list = state.list;
    const r = row.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    if (r.top < l.top) list.scrollTop += r.top - l.top;
    else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
  }

  function moveSelection(step) {
    const rows = visibleRows();
    if (!rows.length) return;
    const at = rows.findIndex((row) => row.dataset.index === String(state.selected));
    const next = at < 0 ? (step > 0 ? 0 : rows.length - 1) : (at + step + rows.length) % rows.length;
    select(Number(rows[next].dataset.index), true);
  }

  function selectEdge(which) {
    const rows = visibleRows();
    if (!rows.length) return;
    select(Number(rows[which < 0 ? rows.length - 1 : which].dataset.index), true);
  }

  // ---- Wiring ------------------------------------------------------------

  function attachScroll(container) {
    if (state.container) state.container.removeEventListener('scroll', onScroll);
    state.container = container;
    if (container) container.addEventListener('scroll', onScroll, { passive: true });
  }

  function onScroll() {
    if (state.scrollRaf) return;
    state.scrollRaf = requestAnimationFrame(() => {
      state.scrollRaf = 0;
      updateActive(false);
    });
  }

  // Presses inside the navigator are its own: the chat does not see them.
  function onPointerDown(event) {
    if (state.root && state.root.contains(event.target)) event.stopPropagation();
  }

  function onClick(event) {
    if (!state.root) return;
    if (!state.root.contains(event.target)) {
      if (state.open) {
        setOpen(false);
        // On the scrim the click only closes; nothing underneath gets it.
        if (event.target === state.scrim) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
      return;
    }
    event.stopPropagation();
    if (event.target.closest('.pn-strip')) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.target.closest('.pn-copy')) {
      event.preventDefault();
      const entry = state.entries[state.selected];
      if (entry) copyPrompt(entry.full);
      return;
    }
    if (event.target.closest('.pn-swatch')) {
      event.preventDefault();
      setPalette(!state.paletteOpen);
      return;
    }
    const chip = event.target.closest('.pn-chip');
    if (chip) {
      event.preventDefault();
      if (chip.classList.contains('pn-custom')) {
        // Open the picker on the colour in use, so a tweak starts from it.
        const rgb = resolveColor(state.accent || THEME_ACCENT);
        if (rgb) state.colorInput.value = toHex(rgb);
        state.colorInput.click();
      } else {
        applyAccent(chip.dataset.value);
        saveAccent(chip.dataset.value);
      }
      setPalette(false);
      state.search.focus();
      return;
    }
    if (state.paletteOpen) setPalette(false);
    let row = event.target.closest('.pn-row');
    if (!row && state.list.contains(event.target)) {
      // The row under the pointer, when the click settled on the list itself.
      const under = document.elementFromPoint(event.clientX, event.clientY);
      row = under && under.closest('.pn-row');
    }
    if (!row) return;
    event.preventDefault();
    jumpTo(Number(row.dataset.index));
    setOpen(false);
  }

  function onKey(event) {
    // Alt+P toggles the list. The physical key, so a layout or the macOS
    // Option key turning P into another character still counts.
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === OPEN_KEY) {
      if (!state.open && !state.entries.length) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(!state.open);
      return;
    }
    if (state.open) {
      if (event.ctrlKey || event.metaKey) return;
      const inSearch = event.target === state.search;
      state.keyAt = performance.now();
      switch (event.key) {
        case 'ArrowDown':
          moveSelection(1);
          break;
        case 'ArrowUp':
          moveSelection(-1);
          break;
        case 'Home':
          if (inSearch && state.search.selectionEnd !== 0) return;
          selectEdge(0);
          break;
        case 'End':
          if (inSearch && state.search.selectionStart !== state.search.value.length) return;
          selectEdge(-1);
          break;
        case 'PageDown':
        case 'PageUp': {
          // The list moves by arrow; the page keys scroll a long preview.
          if (!state.preview.classList.contains('pn-shown')) return;
          const body = state.previewBody;
          const step = (body.clientHeight - 24) * (event.key === 'PageDown' ? 1 : -1);
          body.scrollBy({ top: step });
          break;
        }
        case 'Enter': {
          const row =
            state.list.querySelector('.pn-row.pn-selected:not([hidden])') || visibleRows()[0];
          if (row) {
            jumpTo(Number(row.dataset.index));
            setOpen(false);
          }
          break;
        }
        case 'Escape':
          if (state.paletteOpen) {
            setPalette(false);
          } else if (inSearch && state.search.value) {
            state.search.value = '';
            state.query = '';
            applyFilter();
          } else {
            setOpen(false);
          }
          break;
        case 'Tab':
          return;
        default:
          // Typing while the list is open goes to its search box.
          if (!inSearch && event.key.length === 1 && !event.altKey) state.search.focus();
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (!state.entries.length) return;
    const step = event.key === 'ArrowUp' ? -1 : 1;
    const next = Math.min(state.entries.length - 1, Math.max(0, state.active + step));
    if (next === state.active) return;
    event.preventDefault();
    jumpTo(next);
  }

  // Collecting waits for the chat to settle (200 ms), and never runs more
  // often than every 800 ms while a reply streams; under the runaway guard,
  // every 3 s. One timer at a time, so there is nothing to pile up.
  const MIN_GAP = 800;
  const recentCollects = [];
  let backoffUntil = 0;
  let pending = 0;
  function scheduleCollect() {
    clearTimeout(pending);
    const now = performance.now();
    const wait = now < backoffUntil ? 3000 : Math.max(200, MIN_GAP - (now - state.lastCollect));
    pending = setTimeout(collect, wait);
  }

  function start() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', start, { once: true });
      return;
    }
    ensureRoot();
    // Capture phase, so the navigator acts before the chat's own handlers.
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    new MutationObserver((records) => {
      // The navigator's own redraws are not changes in the chat.
      if (state.root && records.every((r) => state.root.contains(r.target))) return;
      scheduleCollect();
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleCollect);
    // A chat hidden behind another tab is skipped; look again when it shows.
    document.addEventListener('visibilitychange', scheduleCollect);
    window.addEventListener('focus', scheduleCollect);
    collect();
  }

  nav.refresh = collect;
  nav.jumpTo = jumpTo;
  start();
})();
