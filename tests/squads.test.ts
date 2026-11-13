import { test } from "node:test";
import assert from "node:assert/strict";
import { createRun } from "../src/shared/createRun";
import { simulate } from "../src/app/simulate";
import { stepCombat } from "../src/features/combat";
import { stepWaves } from "../src/features/waves";
import { stepProgression } from "../src/features/progression";
import {
  planSquadMembers,
  createPendingSquad,
  canEnterSquad,
  activateSquad,
  processPendingSquads,
  finalizeSquads,
  stepSquadSpawning,
  squadEntryPoint,
  SUPPLY_XP,
} from "../src/features/waves/lib/squads";
import type { Enemy, FrameEvents, GameDoc, SquadRole } from "../src/shared/types";

const input = { x: 0, y: 0, aim: { x: 700, y: 325 }, firing: false };
const events = (): FrameEvents => ({
  kills: [],
  damage: 0,
  taken: 0,
  shots: 0,
  collected: 0,
  squadSupplies: 0,
});

function deploySquad(
  doc: GameDoc,
  x: number,
  y: number,
): { squadId: number; members: Enemy[] } {
  const pending = createPendingSquad(doc);
  const squad = activateSquad(doc, pending);
  const members = doc.enemies.filter((e) => e.squadId === squad.id);
  members.forEach((e, i) => {
    e.x = x + (i - (members.length - 1) / 2) * 26;
    e.y = y;
  });
  return { squadId: squad.id, members };
}

const bullet = (doc: GameDoc, damage: number, pierce: number, x = 600, y = 325) => ({
  id: doc.nextId++,
  x,
  y,
  vx: 0,
  vy: 0,
  radius: 5,
  damage,
  life: 1,
  owner: "player" as const,
  weapon: "pulse" as const,
  pierce,
  hit: [] as number[],
});

test("wave generation produces squads that share an id and hold distinct role slots", () => {
  const d = createRun();
  d.phase = "playing";
  // 空战场上持续推进预算，直到一支队伍获得出生空间并整体进入。
  for (let i = 0; i < 400 && d.squads.length === 0; i++) {
    stepSquadSpawning(d, 1 / 60);
  }
  assert.ok(d.squads.length > 0, "a squad should eventually be generated");
  const squad = d.squads[0];
  const members = d.enemies.filter((e) => e.squadId === squad.id);
  assert.ok(members.length >= 4);
  const roles = new Set(members.map((e) => e.role));
  assert.ok(roles.has("captain"));
  assert.ok(roles.has("guard"));
  assert.ok(roles.has("shooter"));
  // 独立成员生命，而不是整队共享一个血池。
  const hpValues = new Set(members.map((e) => e.hp));
  assert.ok(hpValues.size > 1, "roles carry their own hp pools");
});

test("a guard intercepts shots aimed at the squad backline while taking the damage itself", () => {
  const d = createRun();
  d.phase = "playing";
  const { members } = deploySquad(d, 600, 325);
  const shooter = members.find((e) => e.role === "shooter")!;
  const guard = members.find((e) => e.role === "guard")!;
  // 其余成员移到远处，避免进入弹道或拦截半径干扰本用例。
  for (const e of members) {
    if (e !== shooter && e !== guard) {
      e.x = 150;
      e.y = 150;
    }
  }
  shooter.x = 600;
  shooter.y = 325;
  guard.x = 600;
  guard.y = 348; // 贴近射手的护卫，在拦截半径内但在静止子弹自身命中圆之外
  const shooterHpBefore = shooter.hp;
  const guardHpBefore = guard.hp;
  d.bullets = [bullet(d, 20, 0)];
  const out = stepCombat(d, input, 0);
  assert.equal(shooter.hp, shooterHpBefore, "backline is shielded");
  assert.ok(guard.hp < guardHpBefore, "guard absorbs the hit");
  assert.ok(out.kills.length <= 1);
});

test("members keep independent hp so a piercing bullet damages each member separately", () => {
  const d = createRun();
  d.phase = "playing";
  const { members } = deploySquad(d, 600, 325);
  // 堆叠所有护卫：它们不会互相挡弹，穿透弹可逐个独立扣血。
  const guards = members.filter((e) => e.role === "guard");
  for (const e of guards) {
    e.x = 600;
    e.y = 325;
  }
  const before = guards.map((e) => e.hp);
  d.bullets = [bullet(d, 5, guards.length + 2)];
  const out = stepCombat(d, input, 0);
  assert.ok(out.damage >= before.length * 5, "each guard loses its own hp");
  const hitGuards = d.enemies.filter(
    (e) => e.squadId !== undefined && e.role === "guard",
  );
  assert.ok(hitGuards.every((e) => e.hp < e.maxHp));
});

test("captain death reassigns the role to a living member in the same frame", () => {
  const d = createRun();
  d.phase = "playing";
  const { squadId, members } = deploySquad(d, 600, 325);
  const captain = members.find((e) => e.role === "captain")!;
  captain.hp = 1;
  const ev = events();
  ev.kills.push({ enemy: { ...captain, hp: 0 }, weapon: "pulse" });
  captain.hp = 0;
  d.enemies = d.enemies.filter((e) => e.hp > 0);
  finalizeSquads(d, ev);
  const alive = d.enemies.filter((e) => e.squadId === squadId);
  const captains = alive.filter((e) => e.role === "captain");
  assert.equal(captains.length, 1, "exactly one successor takes command");
  assert.equal(captains[0].id !== captain.id, true);
});

test("clearing a whole squad emits exactly one supply even when the last two fall to one bullet", () => {
  const d = createRun();
  d.phase = "playing";
  // 手工构建一支含两名护卫的队伍，堆叠到弹道上由一发穿透弹同时击败。
  const squadId = d.nextId++;
  d.squads.push({
    id: squadId,
    color: "#38e1ff",
    colorIndex: 0,
    edge: 0,
    hold: { x: 0, y: 0 },
    rewardIssued: false,
  });
  const mkGuard = (): Enemy => ({
    id: d.nextId++,
    kind: "chaser",
    x: 600,
    y: 325,
    hp: 1,
    maxHp: 1,
    radius: 15,
    cooldown: 0,
    squadId,
    role: "guard",
  });
  d.enemies.push(mkGuard(), mkGuard());
  d.bullets = [bullet(d, 100, 4)];
  const out = stepCombat(d, input, 0);
  const supplies = d.drops.filter((drop) => drop.squadSupply);
  assert.equal(supplies.length, 1, "a single team supply is granted");
  assert.equal(out.squadSupplies, 1);
  // 再次结算不会补发奖励（标记已置位）。
  finalizeSquads(d, events());
  assert.equal(d.drops.filter((drop) => drop.squadSupply).length, 1);
  // 普通成员的经验晶体在掉落结算阶段逐个生成（两名护卫各一枚）。
  stepProgression(d, out, 0);
  const xp = d.drops.filter((drop) => drop.kind === "xp");
  assert.equal(xp.length, 2);
  assert.equal(d.squads.find((s) => s.id === squadId)!.rewardIssued, true);
});

test("squads with insufficient spawn space stay pending and enter together later", () => {
  const d = createRun();
  d.phase = "playing";
  const pending = createPendingSquad(d);
  // 在该队伍的每个真实入场锚点上放置独立敌人，堵死出生空间。
  for (const spec of pending.members) {
    const point = squadEntryPoint(pending.edge, spec.offset, true);
    d.enemies.push({
      id: d.nextId++,
      kind: spec.kind,
      x: point.x,
      y: point.y,
      hp: 40,
      maxHp: 40,
      radius: spec.radius,
      cooldown: 0,
    });
  }
  assert.equal(canEnterSquad(d, pending), false);
  const before = d.enemies.length;
  d.pendingSquads = [pending];
  processPendingSquads(d);
  assert.equal(d.pendingSquads.length, 1, "whole squad is delayed, not split");
  assert.equal(d.squads.length, 0);
  assert.equal(d.enemies.length, before);
  // 清出空间后整队一次性进入。
  d.enemies = [];
  processPendingSquads(d);
  assert.equal(d.pendingSquads.length, 0);
  assert.equal(d.squads.length, 1);
  assert.ok(d.enemies.length >= 4);
});

test("upgrade freeze halts formation and encirclement movement", () => {
  const d = createRun();
  d.phase = "upgrade";
  const { members } = deploySquad(d, 600, 325);
  const snapshot = JSON.stringify(members.map((e) => ({ x: e.x, y: e.y })));
  simulate(d, input, 1 / 60);
  const after = JSON.stringify(members.map((e) => ({ x: e.x, y: e.y })));
  assert.equal(after, snapshot, "frozen during upgrade");
});

test("restarting a run does not retain cleared-squad reward markers", () => {
  const d = createRun();
  d.phase = "playing";
  const { members } = deploySquad(d, 600, 325);
  for (const e of members) {
    if (e.role !== "guard") e.hp = 0;
  }
  d.enemies = d.enemies.filter((e) => e.hp > 0);
  for (const e of d.enemies) {
    e.hp = 1;
    e.maxHp = 1;
    e.x = 600;
    e.y = 325;
  }
  d.bullets = [bullet(d, 100, 12)];
  stepCombat(d, input, 0);
  assert.ok(d.squads.every((s) => s.rewardIssued));
  const fresh = createRun(d.initialSeed);
  assert.equal(fresh.squads.length, 0);
  assert.equal(fresh.pendingSquads.length, 0);
  assert.equal(fresh.drops.filter((drop) => drop.squadSupply).length, 0);
});

test("collecting a team supply heals and grants its bonus experience", () => {
  const d = createRun();
  d.phase = "playing";
  d.player.hp = 30;
  const xpBefore = d.xp;
  d.drops = [
    {
      id: d.nextId++,
      x: d.player.x,
      y: d.player.y,
      kind: "supply",
      value: 25,
      life: 20,
      squadSupply: true,
    },
  ];
  stepProgression(d, events(), 0);
  assert.equal(d.player.hp, 55);
  assert.equal(d.xp, xpBefore + SUPPLY_XP);
  assert.equal(d.drops.length, 0);
});

test("planned squads always contain the three collaborative roles", () => {
  const d = createRun();
  for (let wave = 1; wave <= 8; wave++) {
    d.wave = wave;
    for (let attempt = 0; attempt < 30; attempt++) {
      const specs = planSquadMembers(d);
      const roles = new Set<SquadRole>(specs.map((s) => s.role));
      assert.ok(roles.has("captain"));
      assert.ok(roles.has("guard"));
      assert.ok(roles.has("shooter"));
    }
  }
});
