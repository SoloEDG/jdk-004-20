import type {
  Enemy,
  EnemyKind,
  GameDoc,
  PendingSquad,
  Squad,
  SquadMemberSpec,
  SquadRole,
  Vec,
} from "../../../shared/types";
import { WIDTH, HEIGHT } from "../../../shared/types";
import { distance, normalize, random } from "../../../shared/math";

export const SQUAD_COLORS = [
  "#38e1ff",
  "#7dd86b",
  "#ffb347",
  "#ff6ec7",
  "#8fa6ff",
  "#4ce0b3",
];
export const HOLD_RADIUS = 165;
const ENTER_MARGIN = 30;
const ACTIVE_SQUAD_CAP = 3;

// A team supply restores integrity and grants a chunk of bonus experience.
export const SUPPLY_HEAL = 25;
export const SUPPLY_XP = 6;

const ROLE_STATS: Record<
  SquadRole,
  { kind: EnemyKind; hp: number; radius: number; speed: number; xp: number }
> = {
  // 护卫：高血量、贴身挡弹，不射击。
  guard: { kind: "chaser", hp: 46, radius: 15, speed: 58, xp: 2 },
  // 射手：中程火力，保持距离输出。
  shooter: { kind: "shooter", hp: 26, radius: 13, speed: 40, xp: 3 },
  // 队长：精英火力（三向散射），阵亡后由队员在同一帧接任。
  captain: { kind: "elite", hp: 92, radius: 20, speed: 46, xp: 10 },
};
export const ROLE_XP = { guard: 2, shooter: 3, captain: 10 } as const;

// 局部队形偏移：护卫在前方，射手与队长位于后排。朝向在移动时再旋转。
const FORMATIONS: Record<number, { role: SquadRole; offset: Vec }[]> = {
  4: [
    { role: "captain", offset: { x: 34, y: 0 } },
    { role: "guard", offset: { x: -20, y: -22 } },
    { role: "guard", offset: { x: -20, y: 22 } },
    { role: "shooter", offset: { x: 30, y: -26 } },
  ],
  5: [
    { role: "captain", offset: { x: 38, y: 0 } },
    { role: "guard", offset: { x: -26, y: 0 } },
    { role: "guard", offset: { x: -16, y: -26 } },
    { role: "guard", offset: { x: -16, y: 26 } },
    { role: "shooter", offset: { x: 32, y: -28 } },
  ],
  6: [
    { role: "captain", offset: { x: 40, y: 0 } },
    { role: "guard", offset: { x: -28, y: -18 } },
    { role: "guard", offset: { x: -28, y: 18 } },
    { role: "guard", offset: { x: -6, y: -30 } },
    { role: "shooter", offset: { x: 34, y: -28 } },
    { role: "shooter", offset: { x: 34, y: 28 } },
  ],
};

/** 波次按预算整队生成；成员职责在入队时固定，队长阵亡后再动态重分配。 */
export function planSquadMembers(doc: GameDoc): SquadMemberSpec[] {
  const roll = random(doc);
  const size =
    doc.wave >= 5 ? (roll < 0.45 ? 6 : roll < 0.8 ? 5 : 4) : roll < 0.5 ? 4 : 5;
  const hpScale = 1 + (doc.wave - 1) * 0.2;
  return FORMATIONS[size].map((slot) => {
    const stats = ROLE_STATS[slot.role];
    return {
      role: slot.role,
      kind: stats.kind,
      hp: Math.round(stats.hp * hpScale),
      radius: stats.radius,
      offset: slot.offset,
    };
  });
}

export function createPendingSquad(doc: GameDoc): PendingSquad {
  return {
    id: doc.nextId++,
    edge: Math.floor(random(doc) * 4),
    members: planSquadMembers(doc),
  };
}

/** 沿入场边把局部偏移映射为场内/场外锚点位置。 */
export function squadEntryPoint(
  edge: number,
  offset: Vec,
  inside: boolean,
): Vec {
  const base = inside ? ENTER_MARGIN : -ENTER_MARGIN;
  if (edge === 0) return { x: base, y: HEIGHT / 2 + offset.y };
  if (edge === 1) return { x: WIDTH - base, y: HEIGHT / 2 + offset.y };
  if (edge === 2) return { x: WIDTH / 2 + offset.x, y: base };
  return { x: WIDTH / 2 + offset.x, y: HEIGHT - base };
}

/** 出生空间不足时返回 false，整队延后进入（不会只进来一部分）。 */
export function canEnterSquad(doc: GameDoc, pending: PendingSquad): boolean {
  for (const spec of pending.members) {
    const point = squadEntryPoint(pending.edge, spec.offset, true);
    for (const enemy of doc.enemies) {
      if (enemy.hp > 0 && distance(enemy, point) < enemy.radius + spec.radius + 10)
        return false;
    }
  }
  return true;
}

export function activateSquad(doc: GameDoc, pending: PendingSquad): Squad {
  const colorIndex = doc.squads.length % SQUAD_COLORS.length;
  const squad: Squad = {
    id: pending.id,
    edge: pending.edge,
    color: SQUAD_COLORS[colorIndex],
    colorIndex,
    hold: { x: 0, y: 0 },
    rewardIssued: false,
  };
  for (const spec of pending.members) {
    const point = squadEntryPoint(pending.edge, spec.offset, true);
    doc.enemies.push({
      id: doc.nextId++,
      kind: spec.kind,
      x: point.x,
      y: point.y,
      hp: spec.hp,
      maxHp: spec.hp,
      radius: spec.radius,
      cooldown: 1 + random(doc),
      squadId: squad.id,
      role: spec.role,
    });
  }
  doc.squads.push(squad);
  return squad;
}

/** 延后的整队在每个模拟帧重新检测，空间足够才一次性进入。 */
export function processPendingSquads(doc: GameDoc): void {
  for (let i = doc.pendingSquads.length - 1; i >= 0; i--) {
    const pending = doc.pendingSquads[i];
    if (doc.squads.length >= ACTIVE_SQUAD_CAP) break;
    if (!canEnterSquad(doc, pending)) continue;
    activateSquad(doc, pending);
    doc.pendingSquads.splice(i, 1);
  }
}

/** 波次预算：先尝试整队，再由调用方补充独立敌人。 */
export function stepSquadSpawning(doc: GameDoc, dt: number): void {
  doc.squadBudget += dt * (0.2 + doc.wave * 0.035);
  while (doc.squadBudget >= 1) {
    doc.squadBudget--;
    if (doc.squads.length + doc.pendingSquads.length >= ACTIVE_SQUAD_CAP)
      continue;
    doc.pendingSquads.push(createPendingSquad(doc));
  }
  processPendingSquads(doc);
}

/** 每支队伍共享一个围堵锚点，按队伍序号均匀分布在玩家周围形成合围。 */
function holdPoint(doc: GameDoc, squad: Squad): Vec {
  const angle =
    (squad.colorIndex / SQUAD_COLORS.length) * Math.PI * 2 +
    doc.time * 0.12;
  return {
    x: doc.player.x + Math.cos(angle) * HOLD_RADIUS,
    y: doc.player.y + Math.sin(angle) * HOLD_RADIUS,
  };
}

/**
 * 协作队伍的移动与开火。升级冻结期间 simulate 不会调用本函数，
 * 因此队形保持、围堵决策与冷却都会一并停止。
 */
export function stepSquads(doc: GameDoc, dt: number): void {
  for (const squad of doc.squads) {
    if (squad.rewardIssued) continue;
    squad.hold = holdPoint(doc, squad);
    const facing = Math.atan2(
      doc.player.y - squad.hold.y,
      doc.player.x - squad.hold.x,
    );
    const cos = Math.cos(facing),
      sin = Math.sin(facing);
    for (const enemy of doc.enemies) {
      if (enemy.squadId !== squad.id || enemy.hp <= 0) continue;
      const spec = enemy.role ? ROLE_STATS[enemy.role] : ROLE_STATS.guard;
      // 局部队形偏移旋转到朝向玩家的方向，保持阵型整体推进。
      const formation =
        enemy.role ? rotateOffset(enemy.role, cos, sin) : { x: 0, y: 0 };
      const targetX = squad.hold.x + formation.x;
      const targetY = squad.hold.y + formation.y;
      const dir = normalize(targetX - enemy.x, targetY - enemy.y);
      const scale = 1 + doc.wave * 0.03;
      enemy.x += dir.x * spec.speed * scale * dt;
      enemy.y += dir.y * spec.speed * scale * dt;
      // 同队成员之间做最小分离，避免阵型重叠。
      for (const mate of doc.enemies) {
        if (mate === enemy || mate.squadId !== squad.id || mate.hp <= 0)
          continue;
        const gap = distance(enemy, mate);
        const min = enemy.radius + mate.radius + 2;
        if (gap > 0 && gap < min) {
          const push = normalize(enemy.x - mate.x, enemy.y - mate.y);
          const overlap = (min - gap) / 2;
          enemy.x += push.x * overlap;
          enemy.y += push.y * overlap;
        }
      }
      enemy.cooldown -= dt;
      if (enemy.role === "guard" || enemy.cooldown > 0) continue;
      const toward = normalize(
        doc.player.x - enemy.x,
        doc.player.y - enemy.y,
      );
      const angle = Math.atan2(toward.y, toward.x);
      const isCaptain = enemy.role === "captain";
      enemy.cooldown = isCaptain ? 1.9 : 2.5;
      const spread = isCaptain ? [-0.24, 0, 0.24] : [0];
      for (const offset of spread) {
        doc.bullets.push({
          id: doc.nextId++,
          x: enemy.x,
          y: enemy.y,
          vx: Math.cos(angle + offset) * 165,
          vy: Math.sin(angle + offset) * 165,
          radius: 5,
          damage: isCaptain ? 14 : 10,
          life: 5,
          owner: "enemy",
          weapon: "enemy",
          pierce: 0,
          hit: [],
        });
      }
    }
  }
}

// 移动阶段使用的职责级队形偏移（局部坐标，x 指向玩家）。
const ROLE_FORMATION: Record<SquadRole, Vec> = {
  guard: { x: -22, y: 0 },
  shooter: { x: 32, y: -26 },
  captain: { x: 38, y: 0 },
};
function rotateOffset(role: SquadRole, cos: number, sin: number): Vec {
  const o = ROLE_FORMATION[role];
  return { x: o.x * cos - o.y * sin, y: o.x * sin + o.y * cos };
}

/**
 * 护卫挡弹：射向同队后排（队长/射手）的子弹，若附近有存活护卫，
 * 改由护卫承担伤害。每个成员仍保留独立生命，穿透判定与命中记录不变。
 */
export function interceptTarget(doc: GameDoc, enemy: Enemy): Enemy {
  if (!enemy.squadId || enemy.role === "guard") return enemy;
  let guard: Enemy | undefined;
  let best = Infinity;
  for (const mate of doc.enemies) {
    if (
      mate.squadId !== enemy.squadId ||
      mate.role !== "guard" ||
      mate.hp <= 0
    )
      continue;
    const gap = distance(mate, enemy);
    if (gap < mate.radius + enemy.radius + 26 && gap < best) {
      guard = mate;
      best = gap;
    }
  }
  return guard ?? enemy;
}

/**
 * 帧末结算：整队被清除时发放且仅发放一次队伍补给；队长阵亡则由存活成员
 * 在同一帧重分配职责（优先护卫，其次射手）。
 */
export function finalizeSquads(doc: GameDoc, events?: FrameEventsLike): void {
  for (const squad of doc.squads) {
    const alive = doc.enemies.filter(
      (e) => e.squadId === squad.id && e.hp > 0,
    );
    if (alive.length === 0) {
      if (!squad.rewardIssued) {
        squad.rewardIssued = true;
        const origin = supplyOrigin(doc, events, squad.id);
        doc.drops.push({
          id: doc.nextId++,
          x: origin.x,
          y: origin.y,
          kind: "supply",
          value: SUPPLY_HEAL,
          life: 30,
          squadSupply: true,
        });
        if (events) events.squadSupplies++;
      }
      continue;
    }
    if (!alive.some((e) => e.role === "captain")) {
      const successor =
        alive.find((e) => e.role === "guard") ??
        alive.find((e) => e.role === "shooter");
      if (successor) {
        successor.role = "captain";
        successor.kind = ROLE_STATS.captain.kind;
        successor.radius = ROLE_STATS.captain.radius;
      }
    }
  }
}

interface FrameEventsLike {
  kills: { enemy: Enemy }[];
  squadSupplies: number;
}

function supplyOrigin(
  doc: GameDoc,
  events: FrameEventsLike | undefined,
  squadId: number,
): Vec {
  // 优先使用本帧最后一名阵亡成员的位置，保证补给落在交火点。
  if (events) {
    for (let i = events.kills.length - 1; i >= 0; i--) {
      if (events.kills[i].enemy.squadId === squadId) {
        const e = events.kills[i].enemy;
        return { x: e.x, y: e.y };
      }
    }
  }
  return { x: doc.player.x, y: doc.player.y };
}
