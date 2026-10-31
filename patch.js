#!/usr/bin/env node
/*
 * Applies prompt-nav.js to every installed Claude Code VS Code extension by
 * appending it to webview/index.js, between two marker comments. Idempotent:
 * a current patch is left alone, an older one is replaced, and --undo strips it.
 *
 *   node patch.js            apply (or refresh) the patch
 *   node patch.js --check    report each install's state without changing it
 *   node patch.js --undo     remove the patch
 *   node patch.js --root DIR look in DIR instead of the usual extension folders
 *
 * Each run also checks the install's stylesheet for the class names the
 * script finds the chat by, and warns when an update has renamed any.
 *
 * Also required by extension.js, which runs the same logic on VS Code start.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const START = '/*! prompt-nav:start';
const END = '/*! prompt-nav:end */';
const BACKUP_SUFFIX = '.prompt-nav.orig';

// Every place VS Code keeps user extensions on this machine.
function roots(extra = []) {
  const home = os.homedir();
  const candidates = [
    ...extra,
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.vscode-oss', 'extensions'),
    path.join(home, '.vscode-server', 'extensions'),
  ];
  return [...new Set(candidates)].filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

// The webview bundle of each installed Claude Code version.
function targets(rootList) {
  const found = [];
  for (const root of rootList) {
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^anthropic\.claude-code-/.test(name)) continue;
      const file = path.join(root, name, 'webview', 'index.js');
      if (fs.existsSync(file)) found.push({ root, name, file });
    }
  }
  return found;
}

// The class-name prefixes the script finds the chat by: every byPrefix('…')
// in prompt-nav.js, so the list is kept in one place.
function prefixesOf(scriptPath) {
  const source = fs.readFileSync(scriptPath, 'utf8');
  return [...new Set(Array.from(source.matchAll(/byPrefix\('([^']+)'\)/g), (m) => m[1]))];
}

// The prefixes an install's chat no longer uses. Its stylesheet carries every
// class name the chat is drawn with (as ".userMessage_07S1Yg") and is never
// patched, unlike index.js, which holds the script and its prefixes. null
// when there is no stylesheet to read, so nothing is claimed either way.
function missingOf(target, prefixes) {
  let css;
  try {
    css = fs.readFileSync(path.join(path.dirname(target.file), 'index.css'), 'utf8');
  } catch {
    return null;
  }
  return prefixes.filter((prefix) => !new RegExp(`\\.${prefix}[A-Za-z0-9]`).test(css));
}

function payloadOf(scriptPath) {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 12);
  // A leading ";" ends whatever the bundle's last statement was.
  const block = `\n;${START} ${hash} */\n${source}\n${END}\n`;
  return { block, hash };
}

function stateOf(text, hash) {
  const at = text.indexOf(START);
  if (at < 0) return 'unpatched';
  const found = /prompt-nav:start ([0-9a-f]+)/.exec(text.slice(at, at + 64));
  return found && found[1] === hash ? 'current' : 'stale';
}

function strip(text) {
  const at = text.indexOf(`\n;${START}`);
  const end = text.indexOf(END);
  if (at < 0 || end < 0) return text;
  return text.slice(0, at) + text.slice(end + END.length).replace(/^\n/, '');
}

function apply({ scriptPath, rootList = roots(), dryRun = false }) {
  const { block, hash } = payloadOf(scriptPath);
  const prefixes = prefixesOf(scriptPath);
  return targets(rootList).map((target) => {
    const missing = missingOf(target, prefixes);
    const before = fs.readFileSync(target.file, 'utf8');
    const state = stateOf(before, hash);
    if (state === 'current') return { ...target, state, missing, action: 'kept' };
    if (!dryRun) {
      const backup = target.file + BACKUP_SUFFIX;
      if (state === 'unpatched' && !fs.existsSync(backup)) fs.copyFileSync(target.file, backup);
      fs.writeFileSync(target.file, strip(before) + block);
    }
    return { ...target, state, missing, action: state === 'stale' ? 'updated' : 'patched' };
  });
}

function remove({ rootList = roots(), dryRun = false } = {}) {
  return targets(rootList).map((target) => {
    const before = fs.readFileSync(target.file, 'utf8');
    if (before.indexOf(START) < 0) return { ...target, state: 'unpatched', action: 'kept' };
    if (!dryRun) fs.writeFileSync(target.file, strip(before));
    return { ...target, state: 'patched', action: 'removed' };
  });
}

function check({ scriptPath, rootList = roots() }) {
  const { hash } = payloadOf(scriptPath);
  const prefixes = prefixesOf(scriptPath);
  return targets(rootList).map((target) => ({
    ...target,
    state: stateOf(fs.readFileSync(target.file, 'utf8'), hash),
    missing: missingOf(target, prefixes),
    action: 'none',
  }));
}

module.exports = { roots, targets, apply, remove, check, START, END };

if (require.main === module) {
  const args = process.argv.slice(2);
  const extraRoots = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--root' && args[i + 1]) extraRoots.push(args[++i]);
  const scriptPath = path.join(__dirname, 'prompt-nav.js');
  const rootList = roots(extraRoots);
  const results = args.includes('--undo')
    ? remove({ rootList })
    : args.includes('--check')
      ? check({ scriptPath, rootList })
      : apply({ scriptPath, rootList });
  if (!results.length) {
    console.log(`No Claude Code extension found under: ${rootList.join(', ') || '(no extension folders)'}`);
    process.exit(1);
  }
  for (const r of results) {
    console.log(`${r.action.padEnd(8)} ${r.state.padEnd(9)} ${r.file}`);
    if (r.missing && r.missing.length) {
      console.log(`  warning: this Claude Code no longer uses ${r.missing.join(', ')}; update the prefixes in prompt-nav.js`);
    }
  }
  if (results.some((r) => r.action === 'patched' || r.action === 'updated' || r.action === 'removed')) {
    console.log('\nReload VS Code windows (Developer: Reload Window) to pick this up.');
  }
}
