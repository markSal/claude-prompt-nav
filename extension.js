// Companion extension: keeps prompt-nav.js applied to the Claude Code chat
// webview. On every VS Code start it re-applies the patch if Claude Code was
// updated, and it watches the extension folders so an update that lands
// mid-session is patched before the next reload. When an update renames the
// chat's class names, it says so once per Claude Code version instead of
// leaving the strip to vanish silently.
'use strict';

const fs = require('fs');
const vscode = require('vscode');
const patch = require('./patch');

const CHANGED = new Set(['patched', 'updated']);

function activate(context) {
  const scriptPath = context.asAbsolutePath('prompt-nav.js');

  const offerReload = (message) =>
    vscode.window.showInformationMessage(message, 'Reload Window').then((pick) => {
      if (pick === 'Reload Window') vscode.commands.executeCommand('workbench.action.reloadWindow');
    });

  const run = (interactive) => {
    let results;
    try {
      results = patch.apply({ scriptPath });
    } catch (error) {
      if (interactive) vscode.window.showErrorMessage(`Claude Prompt Nav: ${error.message}`);
      return;
    }
    warnMissing(results, interactive);
    const changed = results.filter((r) => CHANGED.has(r.action));
    if (changed.length) {
      const versions = changed.map((r) => r.name.replace(/^anthropic\.claude-code-/, '')).join(', ');
      offerReload(`Claude Prompt Nav was applied to Claude Code ${versions}. Reload to use it.`);
    } else if (interactive) {
      vscode.window.showInformationMessage(
        results.length
          ? 'Claude Prompt Nav is already applied to the installed Claude Code.'
          : 'Claude Prompt Nav: no Claude Code extension was found.',
      );
    }
  };

  // Once per Claude Code version, so a known break does not nag every start;
  // the Re-apply command always says.
  const warnMissing = (results, interactive) => {
    for (const r of results) {
      if (!r.missing || !r.missing.length) continue;
      const version = r.name.replace(/^anthropic\.claude-code-/, '');
      const key = `warned:${version}`;
      if (!interactive && context.globalState.get(key)) continue;
      context.globalState.update(key, true);
      vscode.window.showWarningMessage(
        `Claude Prompt Nav may not work with Claude Code ${version}: its chat no longer uses ` +
          `${r.missing.join(', ')}. The prompt strip may not appear until Claude Prompt Nav is updated.`,
      );
    }
  };

  run(false);

  // A Claude Code update installs a new version folder: patch it right away.
  let pending;
  for (const root of patch.roots()) {
    try {
      const watcher = fs.watch(root, () => {
        clearTimeout(pending);
        pending = setTimeout(() => run(false), 2000);
      });
      context.subscriptions.push({ dispose: () => watcher.close() });
    } catch {
      // A folder that cannot be watched is still patched on the next start.
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('claudePromptNav.reapply', () => run(true)),
    vscode.commands.registerCommand('claudePromptNav.remove', () => {
      const removed = patch.remove().filter((r) => r.action === 'removed');
      if (removed.length) offerReload('Claude Prompt Nav was removed from Claude Code. Reload to finish.');
      else vscode.window.showInformationMessage('Claude Prompt Nav: nothing to remove.');
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
