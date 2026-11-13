import type { GameDoc, FrameEvents } from "../../../shared/types";
import { random, distance, normalize } from "../../../shared/math";
import { grantExperience } from "./experience";
import { ROLE_XP, SUPPLY_XP } from "../../waves/lib/squads";

export function generateDrops(doc: GameDoc, events: FrameEvents): void {
  for (const { enemy } of events.kills) {
    // 队伍普通成员仍按职责掉落各自的经验晶体，整队奖励另行通过补给发放。
    const value =
      enemy.role !== undefined
        ? ROLE_XP[enemy.role]
        : enemy.kind === "elite"
          ? 10
          : enemy.kind === "shooter"
            ? 3
            : 2;
    doc.drops.push({
      id: doc.nextId++,
      x: enemy.x,
      y: enemy.y,
      kind: "xp",
      value,
      life: 45,
    });
    const roll = random(doc);
    if (roll < 0.055)
      doc.drops.push({
        id: doc.nextId++,
        x: enemy.x + 8,
        y: enemy.y,
        kind: "heal",
        value: 18,
        life: 20,
      });
    else if (roll < 0.07)
      doc.drops.push({
        id: doc.nextId++,
        x: enemy.x - 8,
        y: enemy.y,
        kind: "magnet",
        value: 1,
        life: 20,
      });
  }
}
export function collectDrops(
  doc: GameDoc,
  events: FrameEvents,
  dt: number,
): void {
  const radius = 65 + (doc.upgrades.magnet || 0) * 35;
  let magnet = false;
  for (const drop of doc.drops) {
    drop.life -= dt;
    if (drop.life < 0) continue;
    const range = distance(drop, doc.player);
    if (range < radius) {
      const toward = normalize(doc.player.x - drop.x, doc.player.y - drop.y),
        travel = Math.min(range, 360 * dt);
      drop.x += toward.x * travel;
      drop.y += toward.y * travel;
    }
    if (distance(drop, doc.player) > doc.player.radius + 9) continue;
    drop.life = -1;
    events.collected++;
    if (drop.kind === "xp") grantExperience(doc, drop.value);
    if (drop.kind === "heal")
      doc.player.hp = Math.min(doc.player.maxHp, doc.player.hp + drop.value);
    if (drop.kind === "supply") {
      // 整队清除的额外队伍补给：修复机体并额外奖励经验。
      doc.player.hp = Math.min(
        doc.player.maxHp,
        doc.player.hp + drop.value,
      );
      grantExperience(doc, SUPPLY_XP);
    }
    if (drop.kind === "magnet") magnet = true;
  }
  if (magnet) {
    for (const drop of doc.drops) {
      if (drop.life >= 0 && drop.kind === "xp") {
        grantExperience(doc, drop.value);
        drop.life = -1;
        events.collected++;
      }
    }
  }
  doc.drops = doc.drops.filter((d) => d.life >= 0);
}
