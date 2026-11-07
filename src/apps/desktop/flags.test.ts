import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsFor,
  COLUMN_FLAGS,
  DEFAULT_FLAGS,
  flagsFromEnv,
  flagsToQuery,
  inRect,
  isPowerEvent,
  isShellCommand,
  menuTemplate,
  normaliseState,
  parseFlags,
  SHORTCUT_ACCELERATOR,
  toHitRect,
  trayTitle,
} from './flags.ts';
import type { MenuActions, MenuModel, ShellCommand } from './flags.ts';

test('flags: defaults, fidgets off, env overrides', () => {
  assert.deepEqual(flagsFromEnv({}), { ...DEFAULT_FLAGS });
  assert.equal(DEFAULT_FLAGS.fidgets, false);
  const f = flagsFromEnv({ KT_COMPANION: '0', KT_FIDGETS: '1', KT_DRAG: 'off', KT_GAZE: 'nonsense' });
  assert.equal(f.companion, false);
  assert.equal(f.fidgets, true);
  assert.equal(f.drag, false);
  assert.equal(f.gaze, true, 'unparseable value keeps the default');
});

test('flags: column mode turns everything off, env can still turn one on', () => {
  assert.deepEqual(flagsFromEnv({ KT_WINDOW_MODE: 'column' }), { ...COLUMN_FLAGS });
  const f = flagsFromEnv({ KT_WINDOW_MODE: 'column', KT_SHORTCUT: '1' });
  assert.equal(f.windowMode, 'column');
  assert.equal(f.shortcut, true);
  assert.equal(f.away, false);
});

test('flags: query round trip and missing params', () => {
  const f = flagsFromEnv({ KT_AWAY: '0', KT_FIDGETS: 'true' });
  const q = new URLSearchParams(flagsToQuery(f));
  q.set('mock', '1');
  assert.deepEqual(parseFlags(q), f);
  assert.deepEqual(parseFlags('?' + q.toString()), f);
  assert.deepEqual(parseFlags(''), { ...DEFAULT_FLAGS });
  assert.deepEqual(parseFlags('?window=column'), { ...COLUMN_FLAGS });
});

test('bounds: area = work area exactly; column = the R28 placeBottomRight', () => {
  const wa = { x: 0, y: 33, width: 1512, height: 870 };
  assert.deepEqual(boundsFor('area', wa), wa);
  assert.deepEqual(boundsFor('column', wa), { x: 1512 - 420 - 12, y: 33 + 870 - 858 - 12, width: 420, height: 858 });
  assert.deepEqual(boundsFor('column', { x: 0, y: 25, width: 1280, height: 600 }, 320), { x: 1280 - 320 - 12, y: 25 + 600 - 680 - 12, width: 320, height: 680 });
});

test('hit rects: edges, empty rects never hit', () => {
  const r = toHitRect({ left: 10, top: 20, width: 64, height: 64 });
  assert.ok(inRect(r, 10, 20));
  assert.ok(inRect(r, 73.9, 83.9));
  assert.ok(!inRect(r, 74, 50));
  assert.ok(!inRect(r, 9.9, 50));
  assert.equal(toHitRect({ left: 0, top: 0, width: 0, height: 10 }), null);
  assert.ok(!inRect(null, 0, 0));
});

test('ipc payload guards', () => {
  assert.ok(isShellCommand('toggle-away'));
  assert.ok(!isShellCommand('hide'));
  assert.ok(isPowerEvent('unlock-screen'));
  assert.ok(!isPowerEvent('suspend'));
  assert.deepEqual(normaliseState({ away: true, question: 'yes' }), { away: true, question: false });
  assert.deepEqual(normaliseState(null), { away: false, question: false });
});

test('tray title: " ?" only while away with a question', () => {
  assert.equal(trayTitle({ away: true, question: true }), ' ?');
  assert.equal(trayTitle({ away: false, question: true }), '');
  assert.equal(trayTitle({ away: true, question: false }), '');
});

const recorder = (): { calls: string[]; actions: MenuActions } => {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      command: (c: ShellCommand) => calls.push('command:' + c),
      hide: () => calls.push('hide'),
      show: () => calls.push('show'),
      resetDemo: () => calls.push('reset'),
      quit: () => calls.push('quit'),
    },
  };
};
const click = (item: { click?: unknown }): void => (item.click as () => void)();

test('menu: away / back label follows the reported state, accelerator only when registered', () => {
  const { calls, actions } = recorder();
  const base: MenuModel = { flags: { ...DEFAULT_FLAGS }, state: { away: false, question: false }, shortcutRegistered: true, visible: true };
  const inMenu = menuTemplate(base, actions);
  assert.deepEqual(inMenu.map((i) => i.label ?? i.type), ['Send Snowbally away', 'Put Snowbally back in the corner', 'Reset demo', 'separator', 'Hide completely (stops questions)', 'Quit']);
  assert.equal(inMenu[0]!.accelerator, SHORTCUT_ACCELERATOR);
  assert.equal(inMenu[0]!.registerAccelerator, false);
  click(inMenu[0]!);
  click(inMenu[1]!);
  const awayMenu = menuTemplate({ ...base, state: { away: true, question: true }, shortcutRegistered: false }, actions);
  assert.equal(awayMenu[0]!.label, 'Bring Snowbally back');
  assert.equal(awayMenu[0]!.accelerator, undefined);
  click(awayMenu[0]!);
  click(awayMenu[4]!);
  assert.deepEqual(calls, ['command:away', 'command:reset-position', 'command:return', 'hide']);
  const hidden = menuTemplate({ ...base, visible: false }, actions);
  assert.equal(hidden[0]!.label, 'Bring Snowbally back');
  assert.equal(hidden[4]!.enabled, false);
});

test('menu: fallback (column / companion off) is the R28 menu', () => {
  const { calls, actions } = recorder();
  const m = menuTemplate({ flags: { ...COLUMN_FLAGS }, state: { away: false, question: false }, shortcutRegistered: false, visible: true }, actions);
  assert.deepEqual(m.map((i) => i.label ?? i.type), ['Show / Hide Snowbally', 'Reset demo', 'separator', 'Quit']);
  click(m[0]!);
  assert.deepEqual(calls, ['hide']);
});
