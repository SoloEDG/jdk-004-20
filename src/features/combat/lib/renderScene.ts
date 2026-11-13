import type { GameDoc, Squad } from "../../../shared/types";
import { WIDTH, HEIGHT } from "../../../shared/types";
import { distance } from "../../../shared/math";

function drawSquadOverlay(ctx: CanvasRenderingContext2D, d: GameDoc): void {
  for (const squad of d.squads) {
    if (squad.rewardIssued) continue;
    const members = d.enemies.filter(
      (e) => e.squadId === squad.id && e.hp > 0,
    );
    if (!members.length) continue;
    // 围堵意图：从队伍锚点指向玩家周边的合围点。
    ctx.strokeStyle = squad.color;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([4, 7]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(squad.hold.x, squad.hold.y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(squad.hold.x, squad.hold.y);
    ctx.lineTo(d.player.x, d.player.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // 成员关系：同队成员与存活成员连线，颜色即队伍标识。
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (distance(members[i], members[j]) > 90) continue;
        ctx.beginPath();
        ctx.moveTo(members[i].x, members[i].y);
        ctx.lineTo(members[j].x, members[j].y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

function drawRoleMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  role: NonNullable<GameDoc["enemies"][number]["role"]>,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  if (role === "captain") {
    // 队长：菱形徽记。
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 5, y);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x - 5, y);
    ctx.closePath();
    ctx.stroke();
  } else if (role === "guard") {
    // 护卫：盾形括弧。
    ctx.beginPath();
    ctx.arc(x, y, 8, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  } else {
    // 射手：准星。
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 9, y);
    ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + 9, y);
    ctx.stroke();
  }
}

export function renderScene(ctx: CanvasRenderingContext2D, d: GameDoc) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#0a1019";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = "#172431";
  ctx.lineWidth = 0.6;
  for (let x = 0; x < WIDTH; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#2d424d";
  ctx.setLineDash([6, 8]);
  ctx.strokeRect(28, 28, WIDTH - 56, HEIGHT - 56);
  ctx.setLineDash([]);
  ctx.strokeStyle = "#152c35";
  for (const r of [110, 220, 330]) {
    ctx.beginPath();
    ctx.arc(500, 325, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const drop of d.drops) {
    ctx.fillStyle =
      drop.kind === "xp"
        ? "#9eeaa6"
        : drop.kind === "heal"
          ? "#fc91aa"
          : drop.kind === "supply"
            ? "#5eead4"
            : "#8ac6ff";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.save();
    ctx.translate(drop.x, drop.y);
    if (drop.kind === "supply") {
      // 队伍补给：青色六边形，区别于普通菱形掉落。
      ctx.rotate(d.time * 0.8);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * 7,
          py = Math.sin(a) * 7;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4, -4, 8, 8);
    }
    ctx.restore();
  }
  ctx.shadowBlur = 0;
  drawSquadOverlay(ctx, d);
  for (const e of d.enemies) {
    const color =
      e.kind === "shooter"
        ? "#bb9eff"
        : e.kind === "elite"
          ? "#ffae70"
          : "#ed697b";
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    if (e.kind === "chaser") {
      ctx.moveTo(e.x, e.y - 12);
      ctx.lineTo(e.x + 11, e.y + 9);
      ctx.lineTo(e.x - 11, e.y + 9);
      ctx.closePath();
    } else {
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    if (e.squadId !== undefined) {
      const squad: Squad | undefined = d.squads.find(
        (s) => s.id === e.squadId,
      );
      if (squad) {
        // 队伍色外圈：在战场上标识成员归属。
        ctx.strokeStyle = squad.color;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (e.role) drawRoleMark(ctx, e.x, e.y - e.radius - 10, e.role, squad.color);
      }
    }
    ctx.fillStyle = "#10121d";
    ctx.beginPath();
    ctx.arc(e.x, e.y, 4, 0, Math.PI * 2);
    ctx.fill();
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "#ef7287";
      ctx.fillRect(e.x - 14, e.y - 22, (28 * e.hp) / e.maxHp, 2);
    }
  }
  for (const b of d.bullets) {
    ctx.fillStyle =
      b.owner === "enemy"
        ? "#ff827d"
        : b.weapon === "nova"
          ? "#ba9fff"
          : b.weapon === "orbit"
            ? "#f7cd79"
            : "#a7ffe1";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  const p = d.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = "#9eeeb3";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = p.invincible > 0 ? 0.45 : 1;
  ctx.shadowColor = "#a9ffd7";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#cdfedc";
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.lineTo(12, 11);
  ctx.lineTo(0, 7);
  ctx.lineTo(-12, 11);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#193b3b";
  ctx.fillRect(-3, -3, 6, 6);
  ctx.restore();
  ctx.fillStyle = "#526571";
  ctx.font = "10px monospace";
  ctx.fillText("SECTOR 07 / SIGNAL ACTIVE", 48, HEIGHT - 42);
  ctx.fillText(
    `${d.enemies.length.toString().padStart(3, "0")} HOSTILES`,
    WIDTH - 145,
    HEIGHT - 42,
  );
}
