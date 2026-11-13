import type { GameDoc } from "../../../shared/types";
import { distance, normalize } from "../../../shared/math";
import { spawnEnemy } from "../lib/spawn";
import { ENEMY_CATALOG, WAVE_DURATION, TOTAL_WAVES } from "./catalog";
import { stepSquadSpawning, stepSquads } from "../lib/squads";

export function stepWaves(doc: GameDoc, dt: number): void {
  if (doc.victory) return;
  if (doc.wave === 0) {
    doc.wave = 1;
    doc.spawnBudget = 1;
    doc.notice = "第 1 波 · 信号已连接";
  }
  doc.waveTime += dt;
  while (doc.waveTime >= WAVE_DURATION) {
    doc.waveTime -= WAVE_DURATION;
    if (doc.wave >= TOTAL_WAVES) {
      doc.victory = true;
      doc.notice = "全部波次已清除";
      return;
    }
    doc.wave++;
    doc.notice = `第 ${doc.wave} 波 · 威胁升级`;
  }
  // 协作队伍按波次整队生成，出生空间不足时整队延后进入。
  stepSquadSpawning(doc, dt);
  // 独立敌人继续按原节奏补充，维持战场压力。
  doc.spawnBudget += dt * (0.62 + doc.wave * 0.16);
  while (doc.spawnBudget >= 1) {
    doc.spawnBudget--;
    if (doc.enemies.length < 180) doc.enemies.push(spawnEnemy(doc));
  }
  // 队伍成员的队形、围堵与开火由独立模块统一决策。
  stepSquads(doc, dt);
  for (const enemy of doc.enemies) {
    if (enemy.squadId !== undefined) continue;
    const toward = normalize(doc.player.x - enemy.x, doc.player.y - enemy.y),
      range = distance(enemy, doc.player);
    const standOff =
      enemy.kind === "shooter" ? (range < 170 ? -1 : range < 245 ? 0 : 1) : 1;
    const speed = ENEMY_CATALOG[enemy.kind].speed * (1 + doc.wave * 0.035);
    enemy.x += toward.x * speed * standOff * dt;
    enemy.y += toward.y * speed * standOff * dt;
    enemy.cooldown -= dt;
    if (enemy.kind !== "chaser" && enemy.cooldown <= 0) {
      enemy.cooldown = enemy.kind === "elite" ? 1.8 : 2.6;
      const angle = Math.atan2(toward.y, toward.x),
        spread = enemy.kind === "elite" ? [-0.24, 0, 0.24] : [0];
      for (const offset of spread) {
        doc.bullets.push({
          id: doc.nextId++,
          x: enemy.x,
          y: enemy.y,
          vx: Math.cos(angle + offset) * 160,
          vy: Math.sin(angle + offset) * 160,
          radius: 5,
          damage: enemy.kind === "elite" ? 16 : 10,
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
