import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appMenuTemplate,
  boundsFor,
  COLUMN_FLAGS,
  columnIgnoredEnv,
  createReloadGate,
  DEFAULT_FLAGS,
  flagsFromEnv,
  flagsToQuery,
  inRect,
  isPowerEvent,
  isShellCommand,
  menuTemplate,
  nearRects,
  normaliseState,
  parseFlags,
  pinsPress,
  restoreDefaultPriority,
  sameRect,
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

test('flags: column mode turns everything off, env can still turn gaze / fidgets on', () => {
  assert.deepEqual(flagsFromEnv({ KT_WINDOW_MODE: 'column' }), { ...COLUMN_FLAGS });
  const f = flagsFromEnv({ KT_WINDOW_MODE: 'column', KT_GAZE: '1', KT_FIDGETS: '1' });
  assert.equal(f.windowMode, 'column');
  assert.equal(f.gaze, true);
  assert.equal(f.fidgets, true);
  assert.equal(f.away, false);
});

test('flags (shell-16): drag / away / shortcut stay off in the column whatever env or query say', () => {
  const env = { KT_WINDOW_MODE: 'column', KT_COMPANION: '1', KT_AWAY: '1', KT_DRAG: 'on', KT_SHORTCUT: 'yes' };
  const f = flagsFromEnv(env);
  assert.equal(f.away, false);
  assert.equal(f.drag, false);
  assert.equal(f.shortcut, false);
  assert.equal(f.companion, true);
  assert.deepEqual(columnIgnoredEnv(env), ['KT_DRAG', 'KT_AWAY', 'KT_SHORTCUT']);
  assert.deepEqual(columnIgnoredEnv({ KT_AWAY: '1' }), [], 'area mode ignores nothing');
  assert.deepEqual(columnIgnoredEnv({ KT_WINDOW_MODE: 'column', KT_AWAY: '0' }), []);
  const q = parseFlags('?window=column&away=1&drag=1&shortcut=1&companion=1');
  assert.deepEqual([q.away, q.drag, q.shortcut, q.companion], [false, false, false, true]);
  assert.deepEqual(parseFlags(new URLSearchParams(flagsToQuery(f))), f, 'round trip still holds');
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

test('press pinning (shell-03): only a plain primary press pins click-through off', () => {
  assert.equal(pinsPress({ button: 0, ctrlKey: false }), true);
  assert.equal(pinsPress({ button: 0, ctrlKey: true }), false, 'macOS ctrl-click opens the menu');
  assert.equal(pinsPress({ button: 2, ctrlKey: false }), false, 'right-click opens the menu');
  assert.equal(pinsPress({ button: 1, ctrlKey: false }), false);
});

test('measure fallback (shell-12): only near the measured rects, always when nothing is measured', () => {
  const avatar = toHitRect({ left: 1000, top: 700, width: 64, height: 64 });
  const surface = toHitRect({ left: 600, top: 500, width: 380, height: 172 });
  assert.equal(nearRects([null, null], 5, 5), true, 'nothing measured yet');
  assert.equal(nearRects([avatar, null], 1030, 730), true, 'over him');
  assert.equal(nearRects([avatar, null], 1064 + 479, 730), true, 'inside the margin');
  assert.equal(nearRects([avatar, null], 1064 + 480, 730), false, 'just outside the margin');
  assert.equal(nearRects([avatar, null], 10, 10), false, 'far corner of the work area');
  assert.equal(nearRects([avatar, surface], 200, 300), true, 'near the open panel');
  assert.equal(nearRects([avatar, null], 10, 10, 2000), true, 'custom margin');
});

test('display changes (shell-04): sameRect', () => {
  const a = { x: 0, y: 33, width: 1512, height: 868 };
  assert.ok(sameRect(a, { ...a }));
  assert.ok(!sameRect(a, { ...a, height: 870 }));
  assert.ok(!sameRect(a, { ...a, x: 1 }));
});

test('renderer reload gate (shell-07): at most 3 reloads per minute, then again after the window', () => {
  const gate = createReloadGate();
  assert.deepEqual([gate(0), gate(1000), gate(2000), gate(3000)], [true, true, true, false]);
  assert.equal(gate(59_999), false);
  assert.equal(gate(60_000), true, 'the first reload left the window');
  assert.equal(gate(60_001), false);
  const one = createReloadGate(1, 10);
  assert.deepEqual([one(0), one(5), one(10)], [true, false, true]);
});

const priorityOps = (initial: number, opts: { refuse?: boolean; unreadable?: boolean } = {}) => {
  let nice = initial;
  const logs: string[] = [];
  const errors: string[] = [];
  const sets: number[] = [];
  return {
    logs,
    errors,
    sets,
    ops: {
      get: () => {
        if (opts.unreadable) throw new Error('ENOSYS');
        return nice;
      },
      set: (v: number) => {
        sets.push(v);
        if (opts.refuse) throw new Error('EACCES');
        nice = v;
      },
      log: (m: string) => logs.push(m),
      error: (m: string) => errors.push(m),
    },
  };
};

test('priority (M4): a niced launch is reset to 0 and logged before / after', () => {
  const p = priorityOps(10);
  assert.equal(restoreDefaultPriority(p.ops), 'restored');
  assert.deepEqual(p.sets, [0]);
  assert.equal(p.errors.length, 0);
  assert.match(p.logs[0]!, /nice 10; set to 0/);
});

test('priority (M4): normal or higher priority is left alone; refusal and read errors are logged, never thrown', () => {
  for (const nice of [0, -5]) {
    const p = priorityOps(nice);
    assert.equal(restoreDefaultPriority(p.ops), 'normal');
    assert.deepEqual(p.sets, []);
    assert.deepEqual([p.logs.length, p.errors.length], [0, 0]);
  }
  const refused = priorityOps(19, { refuse: true });
  assert.equal(restoreDefaultPriority(refused.ops), 'failed');
  assert.deepEqual(refused.sets, [0]);
  assert.match(refused.errors[0]!, /nice 19; could not reset to 0 \(Error: EACCES\)/);
  const unreadable = priorityOps(5, { unreadable: true });
  assert.equal(restoreDefaultPriority(unreadable.ops), 'failed');
  assert.equal(unreadable.errors.length, 1);
});

test('application menu (shell-08): no Close / Reload / DevTools, Edit kept for the panel input', () => {
  assert.deepEqual(appMenuTemplate(true).map((i) => i.role), ['appMenu', 'editMenu']);
  assert.deepEqual(appMenuTemplate(false).map((i) => i.role), ['editMenu']);
  for (const mac of [true, false]) {
    const roles = appMenuTemplate(mac).map((i) => i.role);
    for (const banned of ['windowMenu', 'viewMenu', 'fileMenu', 'close', 'reload', 'forceReload', 'toggleDevTools']) assert.ok(!roles.includes(banned as never));
  }
});
