import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ballistic, derivedGravity, fallDuration, FALL_REFERENCE_MS, impactSpeed, landingTier, LANDING_SPEED_PX_S,
  ROLL_ACCEL_PX_S2, ROLL_SPEED_PX_S, rollAt, rollDuration, TURN_STEP_PX, turnAt, turnSequence,
} from './physics.ts';
import { ENTRANCE_FALL_MS } from './avatar.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ~ ${b}`);

test('gravity is derived from the R28 launch: D0 still falls in exactly 900 ms, any h in 900*sqrt(h/D0)', () => {
  assert.equal(FALL_REFERENCE_MS, ENTRANCE_FALL_MS);
  for (const d0 of [344, 700, 860, 1300]) {
    const g = derivedGravity(d0);
    close(g, (2 * d0) / 0.81);
    close(fallDuration(d0, g), 900);
    for (const h of [10, 200, 800]) close(fallDuration(h, g), 900 * Math.sqrt(h / d0));
    close(impactSpeed(d0, g), (2 * d0) / 0.9);
  }
  assert.ok(Number.isFinite(derivedGravity(NaN)) && derivedGravity(-5) > 0, 'bad D0 is clamped');
  assert.equal(fallDuration(0, 1000), 0);
});

test('landing tier by impact speed: <450 settle, <1100 hop, else entrance', () => {
  assert.deepEqual(LANDING_SPEED_PX_S, { hop: 450, entrance: 1100 });
  assert.equal(landingTier(0), 'settle');
  assert.equal(landingTier(449.9), 'settle');
  assert.equal(landingTier(450), 'hop');
  assert.equal(landingTier(1099.9), 'hop');
  assert.equal(landingTier(1100), 'entrance');
  assert.equal(landingTier(5000), 'entrance');
  assert.equal(landingTier(NaN), 'settle');
});

test('ballistic release: lift falls monotonically to 0 at the fall time, vx reaches exactly 0 at touchdown', () => {
  const g = derivedGravity(700);
  const b = ballistic(200, g, 400);
  close(b.duration, fallDuration(200, g));
  assert.equal(b.tier, 'hop');
  let prev = Infinity;
  for (let t = 0; t <= b.duration + 50; t += 1000 / 60) {
    const s = b.at(t);
    assert.ok(s.lift <= prev && s.lift >= 0);
    prev = s.lift;
  }
  const end = b.at(b.duration);
  assert.equal(end.landed, true);
  assert.equal(end.lift, 0);
  assert.equal(end.vx, 0);
  close(end.x, (400 * b.duration) / 1000 / 2, 1e-6);
  assert.equal(b.at(0).lift, 200);
  assert.equal(ballistic(800, g).tier, 'entrance');
  assert.equal(ballistic(10, g).tier, 'settle');
  assert.equal(ballistic(0, g).at(0).landed, true);
});

test('turn sequence by direction (1 -> 7 is counter-clockwise = rolling left), one step per 22 px', () => {
  assert.deepEqual(turnSequence('right'), [0, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(turnSequence('left'), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(TURN_STEP_PX, 22);
  assert.equal(turnAt(0, 'right'), 0);
  assert.equal(turnAt(21.9, 'right'), 0);
  assert.equal(turnAt(22, 'right'), 7);
  assert.equal(turnAt(22, 'left'), 1);
  assert.equal(turnAt(-44, 'left'), 2);
  assert.equal(turnAt(8 * 22, 'right'), 0, 'wraps after a full turn');
});

test('roll kinematics: speed-limited trapezoid that never exceeds 900 px/s or 1600 px/s^2 and ends exactly at the distance', () => {
  assert.equal(ROLL_SPEED_PX_S, 900);
  assert.equal(ROLL_ACCEL_PX_S2, 1600);
  for (const d of [1000, -1000, 120, -40]) {
    const T = rollDuration(d);
    let prevV = 0;
    let prevX = 0;
    const dt = 1000 / 120;
    for (let t = 0; t <= T + dt; t += dt) {
      const s = rollAt(d, t);
      assert.ok(s.v <= ROLL_SPEED_PX_S + 1e-9, `speed ${s.v}`);
      assert.ok(Math.abs(s.v - prevV) / (dt / 1000) <= ROLL_ACCEL_PX_S2 + 1e-6, 'acceleration limit');
      assert.ok(Math.sign(d) * (s.x - prevX) >= -1e-9, 'never rolls back');
      assert.equal(s.turn, turnAt(s.x, d < 0 ? 'left' : 'right'));
      prevV = s.v;
      prevX = s.x;
    }
    const end = rollAt(d, T);
    close(end.x, d, 1e-6);
    assert.equal(end.done, true);
    assert.equal(rollAt(d, 0).x, 0);
  }
  // 1000 px: 0.5625 s up, 0.5625 s down, (1000 - 506.25) / 900 s cruising
  close(rollDuration(1000), 1000 * (2 * 0.5625 + (1000 - 506.25) / 900), 1e-6);
  // short roll never reaches full speed
  close(rollDuration(100), 1000 * 2 * Math.sqrt(100 / 1600), 1e-6);
});
