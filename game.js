/* Super Alberto Bro, rumbo a ver el Mundial — HTML5 canvas port of the
   Pygame original. Same constants, level and mechanics; adds touch controls
   for mobile. */

"use strict";

// ------------------------------------------------------------- constants --
const S = {
  WIDTH: 960, HEIGHT: 540, TILE: 48,
  GRAVITY: 2300, MAX_FALL: 1100,
  WALK_SPEED: 270, RUN_SPEED: 400, ACCEL: 2600, AIR_ACCEL: 1800,
  FRICTION: 2800, JUMP_SPEED: -850, JUMP_CUT: 0.45,
  COYOTE: 0.09, BUFFER: 0.12,
  PLAYER_H: 78, ENEMY_H: 66, ENEMY_W: 38, ENEMY_SPEED: 90,
  STOMP_BOUNCE: -430,
  LIVES: 3, COIN_SCORE: 100, ENEMY_SCORE: 200, BOSS_SCORE: 1000,
  INVINCIBLE: 1.5,
  BALL_SPEED: 560, BALL_GRAVITY: 1500, BALL_R: 9,
  START_BALLS: 3, MAX_BALLS: 6, PICKUP_BALLS: 2,
  BOSS_H: 112, BOSS_HP: 3, BOSS_SPEED: 170, BOSS_RANGE: 520,
  TIME_LIMIT: 180, PLATFORM_SPEED: 85,
  ROWS: 15, COLS: 155, GROUND_ROW: 13,
};
const MENU = 0, PLAYING = 1, PAUSED = 2, GAME_OVER = 3, VICTORY = 4;

// ----------------------------------------------------------------- audio --
let actx = null;
function initAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === "suspended") actx.resume();
}
function sweep(f0, f1, dur, vol) {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur);
}
const SND = {
  jump: () => sweep(350, 750, 0.18, 0.3),
  coin: () => sweep(1300, 1800, 0.10, 0.2),
  stomp: () => sweep(220, 70, 0.15, 0.3),
  kick: () => sweep(180, 60, 0.12, 0.4),
  hurt: () => sweep(500, 120, 0.35, 0.3),
  win: () => sweep(500, 1400, 0.7, 0.25),
};

// --------------------------------------------------------------- sprites --
const IMG = { prota: {}, enemiga: {} };
let imagesPending = 0;
function loadSprites(done) {
  const load = (src) => {
    const im = new Image();
    imagesPending++;
    im.onload = () => { if (--imagesPending === 0) done(); };
    im.src = src;
    return im;
  };
  for (const who of ["prota", "enemiga"]) {
    for (const [k, v] of Object.entries(window.SPRITES[who])) {
      IMG[who][k] = Array.isArray(v) ? v.map(load) : load(v);
    }
  }
}
function scaledH(img, h) { return { w: img.width * h / img.height, h: h }; }

// ------------------------------------------------------------------ util --
const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ----------------------------------------------------------------- level --
class MovingPlatform {
  constructor(x, y, w, dirX, dirY, dist) {
    this.rect = { x, y, w, h: 18 };
    this.ox = x; this.oy = y; this.dirX = dirX; this.dirY = dirY;
    this.dist = dist; this.t = 0; this.dx = 0; this.dy = 0;
  }
  update(dt) {
    this.t += dt;
    const s = (this.t * S.PLATFORM_SPEED) % (2 * this.dist);
    const off = s < this.dist ? s : 2 * this.dist - s;
    const nx = this.ox + this.dirX * off, ny = this.oy + this.dirY * off;
    this.dx = nx - this.rect.x; this.dy = ny - this.rect.y;
    this.rect.x = nx; this.rect.y = ny;
  }
}

class Level {
  constructor() {
    const T = S.TILE, G = S.GROUND_ROW;
    this.solids = new Map();       // "c,r" -> "X"|"B"
    this.coins = []; this.enemySpawns = []; this.ballPickups = [];
    this.platforms = []; this.bossSpawn = null;
    this.spawn = [3 * T, (G - 2) * T];
    this.width = S.COLS * T; this.height = S.ROWS * T;

    const ground = (c0, c1) => { for (let c = c0; c <= c1; c++) { this.solids.set(c + "," + G, "X"); this.solids.set(c + "," + (G + 1), "X"); } };
    const bricks = (c0, c1, row) => { for (let c = c0; c <= c1; c++) this.solids.set(c + "," + row, "B"); };
    const block = (c, row, w, h) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) this.solids.set((c + i) + "," + (row - j), "X"); };
    const coins = (c0, c1, row) => { for (let c = c0; c <= c1; c++) this.coins.push({ x: c * T + 12, y: row * T + 12, w: 24, h: 24 }); };
    const enemy = (c, row = G - 1) => this.enemySpawns.push([c * T + 5, row * T + 5]);
    const pickup = (c, row = G - 1) => this.ballPickups.push({ x: c * T + 10, y: row * T + 14, w: 28, h: 28 });

    ground(0, 23); coins(8, 11, 10); pickup(14);
    block(18, 12, 2, 1); block(20, 12, 2, 2);
    bricks(26, 28, 10); coins(26, 28, 9);
    ground(30, 49); enemy(36);
    bricks(40, 43, 10); coins(40, 43, 9);
    bricks(45, 47, 7); coins(45, 47, 6); enemy(41, 9);
    this.platforms.push(new MovingPlatform(50 * T, 10 * T, 3 * T, 1, 0, 2.5 * T));
    ground(56, 76); enemy(61); coins(58, 60, 11); pickup(63);
    for (let i = 0; i < 4; i++) block(66 + i, 12, 1, i + 1);
    coins(66, 69, 7); enemy(73);
    this.platforms.push(new MovingPlatform(78.5 * T, 8 * T, 2 * T, 0, 1, 4 * T));
    ground(83, 102); coins(86, 89, 10); enemy(88); pickup(98);
    bricks(92, 95, 10); coins(92, 95, 9); enemy(93, 9); enemy(99);
    bricks(105, 106, 11); bricks(108, 109, 9); coins(108, 109, 8);
    ground(112, S.COLS - 1); enemy(117);
    bricks(120, 124, 10); coins(120, 124, 9); enemy(122, 9); pickup(126);
    enemy(128);
    for (let i = 0; i < 6; i++) block(133 + i, 12, 1, i + 1);
    this.bossSpawn = [141 * T, (G - 3) * T];
    const fx = 150 * T + T / 2;
    this.flagRect = { x: fx - 4, y: (G - 8) * T, w: 8, h: 8 * T };

    // decorative background bits
    this.clouds = []; this.hills = [];
    for (let i = 0; i < 28; i++)
      this.clouds.push([Math.random() * this.width, 30 + Math.random() * 170, 40 + Math.random() * 50]);
    for (let i = 0; i < 22; i++)
      this.hills.push([Math.random() * this.width, 90 + Math.random() * 80]);
  }

  isSolid(c, r) { return this.solids.has(c + "," + r); }

  solidRectsNear(rect) {
    const T = S.TILE, out = [];
    const c0 = Math.floor(rect.x / T) - 1, c1 = Math.floor((rect.x + rect.w) / T) + 1;
    const r0 = Math.floor(rect.y / T) - 1, r1 = Math.floor((rect.y + rect.h) / T) + 1;
    for (let c = c0; c <= c1; c++)
      for (let r = r0; r <= r1; r++)
        if (this.isSolid(c, r)) out.push({ x: c * T, y: r * T, w: T, h: T });
    for (const p of this.platforms) {
      const big = { x: rect.x - T, y: rect.y - T, w: rect.w + 2 * T, h: rect.h + 2 * T };
      if (rectsOverlap(p.rect, big)) out.push(p.rect);
    }
    return out;
  }

  update(dt) { for (const p of this.platforms) p.update(dt); }
}

// ---------------------------------------------------------------- player --
class Player {
  constructor(pos) {
    const idle = IMG.prota.idle;
    const w = Math.floor(scaledH(idle, S.PLAYER_H).w * 0.6);
    this.rect = { x: pos[0], y: pos[1], w: w, h: S.PLAYER_H - 4 };
    this.vx = 0; this.vy = 0; this.onGround = false; this.facing = 1;
    this.coyote = 0; this.jumpBuf = 0; this.animT = 0;
    this.invincible = 0; this.kickT = 0; this.won = false;
  }
  pressJump() { this.jumpBuf = S.BUFFER; }
  releaseJump() { if (this.vy < 0) this.vy *= S.JUMP_CUT; }
  kick() { this.kickT = 0.28; }

  update(dt, input, level) {
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const top = input.run ? S.RUN_SPEED : S.WALK_SPEED;
    const accel = this.onGround ? S.ACCEL : S.AIR_ACCEL;
    if (dir) {
      this.vx += dir * accel * dt;
      this.vx = Math.max(-top, Math.min(top, this.vx));
      this.facing = dir;
    } else if (this.vx > 0) this.vx = Math.max(0, this.vx - S.FRICTION * dt);
    else this.vx = Math.min(0, this.vx + S.FRICTION * dt);

    this.vy = Math.min(this.vy + S.GRAVITY * dt, S.MAX_FALL);
    this.coyote = this.onGround ? S.COYOTE : this.coyote - dt;
    this.jumpBuf -= dt;
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = S.JUMP_SPEED; this.jumpBuf = 0; this.coyote = 0; SND.jump();
    }
    this.move(dt, level);
    if (this.invincible > 0) this.invincible -= dt;
    if (this.kickT > 0) this.kickT -= dt;
    this.animT += dt;
  }

  move(dt, level) {
    const r = this.rect;
    r.x += this.vx * dt;
    for (const t of level.solidRectsNear(r)) if (rectsOverlap(r, t)) {
      if (this.vx > 0) r.x = t.x - r.w; else if (this.vx < 0) r.x = t.x + t.w;
      this.vx = 0;
    }
    r.y += this.vy * dt;
    this.onGround = false;
    for (const t of level.solidRectsNear(r)) if (rectsOverlap(r, t)) {
      if (this.vy > 0) { r.y = t.y - r.h; this.onGround = true; }
      else if (this.vy < 0) r.y = t.y + t.h;
      this.vy = 0;
    }
  }

  respawn(pos) {
    this.rect.x = pos[0]; this.rect.y = pos[1];
    this.vx = this.vy = 0; this.invincible = 0;
  }

  currentFrame() {
    if (this.won) return IMG.prota.victory;
    if (this.kickT > 0) return IMG.prota.kick;
    if (!this.onGround) return IMG.prota.jump;
    if (Math.abs(this.vx) > 20) {
      const run = IMG.prota.run;
      const i = Math.floor(this.animT * (8 + Math.abs(this.vx) / 60)) % run.length;
      return run[i];
    }
    return IMG.prota.idle;
  }

  draw(ctx, cam) {
    if (this.invincible > 0 && Math.floor(this.invincible * 12) % 2 === 0) return;
    const img = this.currentFrame(), d = scaledH(img, S.PLAYER_H);
    const cx = this.rect.x + this.rect.w / 2 - cam.x;
    const by = this.rect.y + this.rect.h - cam.y;
    ctx.save();
    if (this.facing < 0) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
    ctx.drawImage(img, cx - d.w / 2, by - d.h, d.w, d.h);
    ctx.restore();
  }
}

// ----------------------------------------------------------------- enemy --
class Enemy {
  constructor(pos, boss = false) {
    this.boss = boss;
    const h = boss ? S.BOSS_H : S.ENEMY_H;
    const w = boss ? Math.floor(S.ENEMY_W * S.BOSS_H / S.ENEMY_H) : S.ENEMY_W;
    this.rect = { x: pos[0], y: pos[1], w: w, h: h - 4 };
    this.vx = -(boss ? S.BOSS_SPEED : S.ENEMY_SPEED); this.vy = 0;
    this.alive = true; this.squash = 0; this.t = 0;
    this.hp = boss ? S.BOSS_HP : 1; this.flash = 0;
  }
  get gone() { return !this.alive && this.squash <= 0; }

  hit() {                          // one point of damage
    this.hp -= 1; this.flash = 0.25;
    if (this.hp <= 0) { this.alive = false; this.squash = 0.35; return true; }
    return false;
  }

  update(dt, level, playerRect) {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    if (!this.alive) { this.squash -= dt; return; }
    if (this.boss && playerRect) {
      const dx = playerRect.x + playerRect.w / 2 - (this.rect.x + this.rect.w / 2);
      if (Math.abs(dx) < S.BOSS_RANGE)
        this.vx = dx > 0 ? S.BOSS_SPEED : -S.BOSS_SPEED;
    }
    const r = this.rect;
    this.vy = Math.min(this.vy + S.GRAVITY * dt, S.MAX_FALL);
    r.y += this.vy * dt;
    let onGround = false;
    for (const t of level.solidRectsNear(r)) if (rectsOverlap(r, t)) {
      if (this.vy > 0) { r.y = t.y - r.h; onGround = true; } else r.y = t.y + t.h;
      this.vy = 0;
    }
    r.x += this.vx * dt;
    for (const t of level.solidRectsNear(r)) if (rectsOverlap(r, t)) {
      if (this.vx > 0) r.x = t.x - r.w; else r.x = t.x + t.w;
      this.vx = -this.vx;
    }
    if (onGround) {
      const T = S.TILE;
      const aheadX = this.vx > 0 ? r.x + r.w + 2 : r.x - 2;
      if (!level.isSolid(Math.floor(aheadX / T), Math.floor((r.y + r.h + 4) / T)))
        this.vx = -this.vx;
    }
  }

  draw(ctx, cam) {
    const h = this.boss ? S.BOSS_H : S.ENEMY_H;
    const r = this.rect, cx = r.x + r.w / 2 - cam.x, by = r.y + r.h - cam.y;
    if (!this.alive) {
      const img = IMG.enemiga.idle, d = scaledH(img, h);
      ctx.drawImage(img, cx - (d.w + 10) / 2, by - 14, d.w + 10, 14);
      return;
    }
    if (this.flash > 0 && Math.floor(this.flash * 16) % 2 === 0) return;
    const run = IMG.enemiga.run;
    const img = run[Math.floor(this.t * 9) % run.length], d = scaledH(img, h);
    ctx.save();
    if (this.vx < 0) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
    ctx.drawImage(img, cx - d.w / 2, by - d.h, d.w, d.h);
    ctx.restore();
    if (this.boss) {
      for (let i = 0; i < this.hp; i++) {
        ctx.fillStyle = "#e63c3c";
        ctx.beginPath();
        ctx.arc(cx - 14 + i * 14, r.y - cam.y - 12, 5, 0, 7);
        ctx.fill();
      }
    }
  }
}

// ------------------------------------------------------------------ ball --
class Ball {
  constructor(pos, dir) {
    this.rect = { x: pos[0] - S.BALL_R, y: pos[1] - S.BALL_R, w: S.BALL_R * 2, h: S.BALL_R * 2 };
    this.vx = S.BALL_SPEED * dir; this.vy = -180;
    this.life = 2.2; this.spin = 0; this.dead = false;
  }
  update(dt, level) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.spin += this.vx * dt * 0.05;
    this.vy += S.BALL_GRAVITY * dt;
    this.rect.x += this.vx * dt; this.rect.y += this.vy * dt;
    for (const t of level.solidRectsNear(this.rect)) {
      if (!rectsOverlap(this.rect, t)) continue;
      if (this.vy > 0 && this.rect.y + this.rect.h - t.y < S.TILE * 0.6) {
        this.rect.y = t.y - this.rect.h; this.vy = -Math.abs(this.vy) * 0.55;
      } else this.dead = true;
      return;
    }
    if (this.rect.y > level.height) this.dead = true;
  }
  draw(ctx, cam) {
    const cx = this.rect.x + S.BALL_R - cam.x, cy = this.rect.y + S.BALL_R - cam.y;
    ctx.fillStyle = "#fafafa";
    ctx.beginPath(); ctx.arc(cx, cy, S.BALL_R, 0, 7); ctx.fill();
    ctx.strokeStyle = "#282828"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, S.BALL_R, 0, 7); ctx.stroke();
    ctx.fillStyle = "#282828";
    ctx.beginPath();
    ctx.arc(cx + Math.cos(this.spin) * S.BALL_R * 0.45,
            cy + Math.sin(this.spin) * S.BALL_R * 0.45, 3, 0, 7);
    ctx.fill();
  }
}

// ------------------------------------------------------------------ game --
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = MENU;
    this.time = 0;
    this.input = { left: false, right: false, run: false };
    this.newSession();
  }

  newSession() {
    this.score = 0; this.lives = S.LIVES; this.coinsTaken = 0;
    this.ammo = S.START_BALLS; this.timeLeft = S.TIME_LIMIT;
    this.gameOverMsg = "TE PERDISTE LA FINAL...";
    this.level = new Level();
    this.player = new Player(this.level.spawn);
    this.enemies = this.level.enemySpawns.map((p) => new Enemy(p));
    if (this.level.bossSpawn) this.enemies.push(new Enemy(this.level.bossSpawn, true));
    this.balls = [];
    this.cam = { x: 0, y: 0 };
  }

  // ------------------------------------------------------------- actions
  pressJump() { if (this.state === PLAYING) this.player.pressJump(); }
  releaseJump() { if (this.state === PLAYING) this.player.releaseJump(); }
  kickBall() {
    if (this.state !== PLAYING || this.ammo <= 0 || this.player.won) return;
    this.ammo--;
    this.player.kick();
    const p = this.player.rect;
    this.balls.push(new Ball([p.x + p.w / 2 + this.player.facing * 22,
                              p.y + p.h / 2 - 6], this.player.facing));
    SND.kick();
  }
  confirm() {                     // Enter / tap on menus
    if (this.state === MENU) { this.newSession(); this.state = PLAYING; }
    else if (this.state === GAME_OVER || this.state === VICTORY) this.state = MENU;
  }
  togglePause() {
    if (this.state === PLAYING) this.state = PAUSED;
    else if (this.state === PAUSED) this.state = PLAYING;
  }

  // -------------------------------------------------------------- update
  update(dt) {
    if (this.state !== PLAYING) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.gameOverMsg = "¡EL PARTIDO EMPEZÓ SIN TI!";
      SND.hurt(); this.state = GAME_OVER; return;
    }
    this.level.update(dt);
    this.player.update(dt, this.input, this.level);
    this.ridePlatforms();
    for (const e of this.enemies) e.update(dt, this.level, this.player.rect);
    this.enemies = this.enemies.filter((e) => !e.gone);
    for (const b of this.balls) b.update(dt, this.level);
    this.ballHits();
    this.balls = this.balls.filter((b) => !b.dead);
    this.followCam(dt);
    this.collect();
    this.enemyContacts();
    if (this.player.rect.y > this.level.height + 100) this.loseLife();
    if (rectsOverlap(this.player.rect, this.level.flagRect)) {
      this.player.won = true; SND.win(); this.state = VICTORY;
    }
  }

  ridePlatforms() {
    const p = this.player;
    for (const pl of this.level.platforms) {
      const standing = p.rect.x + p.rect.w > pl.rect.x &&
        p.rect.x < pl.rect.x + pl.rect.w &&
        Math.abs(p.rect.y + p.rect.h - pl.rect.y) <= 4;
      if (!standing) continue;
      p.rect.x += pl.dx;
      if (pl.dy > 0) { p.rect.y += pl.dy; p.onGround = true; }
    }
  }

  ballHits() {
    for (const b of this.balls) {
      if (b.dead) continue;
      for (const e of this.enemies) {
        if (!e.alive || !rectsOverlap(b.rect, e.rect)) continue;
        const down = e.hit();
        this.score += e.boss ? (down ? S.BOSS_SCORE : 150) : S.ENEMY_SCORE;
        b.dead = true; SND.stomp();
        break;
      }
    }
  }

  collect() {
    const pr = this.player.rect;
    this.level.coins = this.level.coins.filter((c) => {
      if (!rectsOverlap(pr, c)) return true;
      this.coinsTaken++; this.score += S.COIN_SCORE; SND.coin();
      return false;
    });
    this.level.ballPickups = this.level.ballPickups.filter((b) => {
      if (!rectsOverlap(pr, b)) return true;
      this.ammo = Math.min(S.MAX_BALLS, this.ammo + S.PICKUP_BALLS); SND.coin();
      return false;
    });
  }

  enemyContacts() {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive || !rectsOverlap(p.rect, e.rect)) continue;
      const fallingOnto = p.vy > 0 &&
        p.rect.y + p.rect.h - e.rect.y < e.rect.h * 0.6;
      if (fallingOnto) {
        const down = e.hit();
        this.score += e.boss ? (down ? S.BOSS_SCORE : 150) : S.ENEMY_SCORE;
        p.vy = S.STOMP_BOUNCE; SND.stomp();
      } else if (p.invincible <= 0) { this.loseLife(); break; }
    }
  }

  loseLife() {
    this.lives--; SND.hurt();
    if (this.lives <= 0) { this.state = GAME_OVER; return; }
    this.player.respawn(this.level.spawn);
    this.player.invincible = S.INVINCIBLE;
    this.cam.x = 0;
  }

  followCam(dt) {
    const goalX = this.player.rect.x + this.player.rect.w / 2 - S.WIDTH / 2;
    const goalY = this.player.rect.y + this.player.rect.h / 2 - S.HEIGHT / 2;
    const t = Math.min(1, 8 * dt);
    this.cam.x += (goalX - this.cam.x) * t;
    this.cam.y += (goalY - this.cam.y) * t;
    this.cam.x = Math.max(0, Math.min(this.cam.x, this.level.width - S.WIDTH));
    this.cam.y = Math.max(0, Math.min(this.cam.y, this.level.height - S.HEIGHT));
  }

  // ---------------------------------------------------------------- draw
  draw() {
    const ctx = this.ctx, cam = this.cam, lvl = this.level, T = S.TILE;
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, S.HEIGHT);
    sky.addColorStop(0, "rgb(92,148,252)");
    sky.addColorStop(1, "rgb(168,208,255)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, S.WIDTH, S.HEIGHT);
    // hills + clouds (parallax)
    ctx.fillStyle = "rgb(110,185,110)";
    for (const [hx, hh] of lvl.hills) {
      const x = ((hx - cam.x * 0.3) % (lvl.width * 0.5) + lvl.width * 0.5) % (lvl.width * 0.5) - 100;
      if (x > -320 && x < S.WIDTH + 320) {
        ctx.beginPath();
        ctx.ellipse(x + 160, S.HEIGHT - hh + hh, 160, hh, 0, 0, 7);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#fff";
    for (const [cx0, cy0, cw] of lvl.clouds) {
      const x = ((cx0 - cam.x * 0.15) % (lvl.width * 0.4) + lvl.width * 0.4) % (lvl.width * 0.4) - 60;
      if (x > -120 && x < S.WIDTH + 120) {
        ctx.beginPath();
        ctx.ellipse(x + cw / 2, cy0 + cw * 0.22, cw / 2, cw * 0.22, 0, 0, 7);
        ctx.fill();
      }
    }
    // tiles
    const c0 = Math.floor(cam.x / T), c1 = Math.floor((cam.x + S.WIDTH) / T) + 1;
    const r0 = Math.floor(cam.y / T), r1 = Math.floor((cam.y + S.HEIGHT) / T) + 1;
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
      const kind = lvl.solids.get(c + "," + r);
      if (!kind) continue;
      const x = c * T - cam.x, y = r * T - cam.y;
      if (kind === "X") {
        ctx.fillStyle = "rgb(155,92,44)"; ctx.fillRect(x, y, T, T);
        if (!lvl.isSolid(c, r - 1)) { ctx.fillStyle = "rgb(96,180,60)"; ctx.fillRect(x, y, T, 10); }
        ctx.strokeStyle = "rgb(90,50,20)"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
      } else {
        ctx.fillStyle = "rgb(196,120,60)"; ctx.fillRect(x, y, T, T);
        ctx.strokeStyle = "rgb(120,70,30)"; ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
        ctx.beginPath();
        ctx.moveTo(x, y + T / 2); ctx.lineTo(x + T, y + T / 2);
        ctx.moveTo(x + T / 2, y); ctx.lineTo(x + T / 2, y + T / 2);
        ctx.stroke();
      }
    }
    // platforms
    for (const p of lvl.platforms) {
      const x = p.rect.x - cam.x, y = p.rect.y - cam.y;
      ctx.fillStyle = "rgb(150,150,165)";
      ctx.beginPath(); ctx.roundRect(x, y, p.rect.w, p.rect.h, 4); ctx.fill();
      ctx.strokeStyle = "rgb(90,90,105)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x, y, p.rect.w, p.rect.h, 4); ctx.stroke();
      ctx.fillStyle = "rgb(90,90,105)";
      for (let bx = x + 8; bx < x + p.rect.w - 4; bx += 24) {
        ctx.beginPath(); ctx.arc(bx, y + p.rect.h / 2, 3, 0, 7); ctx.fill();
      }
    }
    // pickups
    for (const b of lvl.ballPickups) {
      const cx = b.x + b.w / 2 - cam.x;
      const cy = b.y + b.h / 2 - cam.y + Math.sin(this.time * 3 + b.x) * 3;
      ctx.strokeStyle = "rgb(255,255,160)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 18 + Math.sin(this.time * 5) * 2, 0, 7); ctx.stroke();
      ctx.fillStyle = "#fafafa"; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, 7); ctx.fill();
      ctx.strokeStyle = "#282828"; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, 7); ctx.stroke();
      ctx.fillStyle = "#282828"; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.fill();
    }
    // coins
    for (const c of lvl.coins) {
      const cx = c.x + 12 - cam.x;
      const cy = c.y + 12 - cam.y + Math.sin(this.time * 4 + c.x * 0.05) * 3;
      ctx.fillStyle = "rgb(252,200,40)";
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, 7); ctx.fill();
      ctx.fillStyle = "rgb(255,240,150)";
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgb(180,130,20)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, 7); ctx.stroke();
    }
    // flag
    const f = lvl.flagRect, fx = f.x - cam.x, fy = f.y - cam.y;
    ctx.fillStyle = "rgb(200,200,200)"; ctx.fillRect(fx, fy, f.w, f.h);
    ctx.fillStyle = "rgb(255,220,80)";
    ctx.beginPath(); ctx.arc(fx + f.w / 2, fy, 7, 0, 7); ctx.fill();
    const wave = Math.sin(this.time * 3) * 4;
    ctx.fillStyle = "rgb(220,40,40)";
    ctx.beginPath();
    ctx.moveTo(fx + f.w / 2, fy + 6);
    ctx.lineTo(fx + f.w / 2 + 52 + wave, fy + 22);
    ctx.lineTo(fx + f.w / 2, fy + 38);
    ctx.fill();
    // entities
    for (const e of this.enemies) e.draw(ctx, cam);
    for (const b of this.balls) b.draw(ctx, cam);
    this.player.draw(ctx, cam);
    this.drawHUD();
    if (this.state === MENU) this.drawMenu();
    else if (this.state === PAUSED) this.drawPause();
    else if (this.state === GAME_OVER) this.drawGameOver();
    else if (this.state === VICTORY) this.drawVictory();
  }

  text(msg, x, y, size, color = "#fff", align = "center") {
    const ctx = this.ctx;
    ctx.font = "bold " + size + "px 'Courier New', monospace";
    ctx.textAlign = align;
    ctx.fillStyle = "rgb(20,20,40)";
    ctx.fillText(msg, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(msg, x, y);
  }

  drawHUD() {
    const ctx = this.ctx;
    this.text("PUNTOS " + String(this.score).padStart(6, "0"), 120, 32, 20);
    this.text("VIDAS x" + this.lives, 330, 32, 20);
    const tl = Math.max(0, Math.floor(this.timeLeft));
    const m = Math.floor(tl / 60), s = String(tl % 60).padStart(2, "0");
    this.text("INICIO " + m + ":" + s, S.WIDTH / 2 + 60, 32, 20,
              this.timeLeft < 30 ? "rgb(255,80,80)" : "#fff");
    ctx.fillStyle = "rgb(252,200,40)";
    ctx.beginPath(); ctx.arc(S.WIDTH - 250, 26, 10, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgb(180,130,20)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(S.WIDTH - 250, 26, 10, 0, 7); ctx.stroke();
    this.text("x" + this.coinsTaken, S.WIDTH - 210, 32, 20);
    ctx.fillStyle = "#fafafa";
    ctx.beginPath(); ctx.arc(S.WIDTH - 130, 26, 10, 0, 7); ctx.fill();
    ctx.strokeStyle = "#282828";
    ctx.beginPath(); ctx.arc(S.WIDTH - 130, 26, 10, 0, 7); ctx.stroke();
    ctx.fillStyle = "#282828";
    ctx.beginPath(); ctx.arc(S.WIDTH - 130, 26, 3, 0, 7); ctx.fill();
    this.text("x" + this.ammo, S.WIDTH - 90, 32, 20);
  }

  dim(alpha) {
    this.ctx.fillStyle = "rgba(0,0,30," + alpha + ")";
    this.ctx.fillRect(0, 0, S.WIDTH, S.HEIGHT);
  }

  drawMenu() {
    this.dim(0.45);
    this.text("SUPER ALBERTO BRO", S.WIDTH / 2, 130, 34, "rgb(255,220,80)");
    this.text("RUMBO A VER EL MUNDIAL", S.WIDTH / 2, 180, 44, "rgb(255,220,80)");
    this.text("¡Hoy es la final de la Copa del Mundo y llegas tarde!", S.WIDTH / 2, 240, 19);
    this.text("Ella hará lo imposible por impedir que la veas...", S.WIDTH / 2, 270, 19);
    this.text("¡Llega al estadio antes del pitido inicial!", S.WIDTH / 2, 300, 19);
    this.text(IS_TOUCH ? "Toca la pantalla para empezar" : "Pulsa ENTER para empezar",
              S.WIDTH / 2, 365, 26);
    if (!IS_TOUCH) {
      this.text("Flechas/AD mover - Shift correr - Espacio saltar", S.WIDTH / 2, 420, 18);
      this.text("X chutar balón - Esc pausa", S.WIDTH / 2, 450, 18);
    } else {
      this.text("◀ ▶ mover  -  A saltar  -  B chutar", S.WIDTH / 2, 425, 18);
    }
  }
  drawPause() {
    this.dim(0.6);
    this.text("PAUSA", S.WIDTH / 2, 230, 44);
    this.text(IS_TOUCH ? "Toca ⏸ para continuar" : "Esc continuar - Q salir al menú",
              S.WIDTH / 2, 300, 24);
  }
  drawGameOver() {
    this.dim(0.6);
    this.text(this.gameOverMsg, S.WIDTH / 2, 210, 40, "rgb(255,90,90)");
    this.text("Puntuación final: " + this.score, S.WIDTH / 2, 280, 24);
    this.text(IS_TOUCH ? "Toca para volver al menú" : "Pulsa ENTER para el menú",
              S.WIDTH / 2, 340, 24);
  }
  drawVictory() {
    this.dim(0.45);
    this.text("¡LLEGASTE A LA FINAL!", S.WIDTH / 2, 200, 44, "rgb(120,255,120)");
    this.text("Nadie pudo impedir que vieras la Copa del Mundo", S.WIDTH / 2, 255, 19);
    this.text("Puntos " + this.score + "   Monedas " + this.coinsTaken, S.WIDTH / 2, 305, 24);
    this.text(IS_TOUCH ? "Toca para volver al menú" : "Pulsa ENTER para el menú",
              S.WIDTH / 2, 355, 24);
  }
}

// ------------------------------------------------------------ bootstrap --
const IS_TOUCH = "ontouchstart" in window || navigator.maxTouchPoints > 0;
let game = null;

function fitCanvas() {
  const c = document.getElementById("game");
  const scale = Math.min(window.innerWidth / S.WIDTH, window.innerHeight / S.HEIGHT);
  c.style.width = S.WIDTH * scale + "px";
  c.style.height = S.HEIGHT * scale + "px";
}

function bindInputs() {
  const inp = game.input;
  window.addEventListener("keydown", (e) => {
    initAudio();
    if (e.repeat) return;
    switch (e.code) {
      case "ArrowLeft": case "KeyA": inp.left = true; break;
      case "ArrowRight": case "KeyD": inp.right = true; break;
      case "ShiftLeft": case "ShiftRight": inp.run = true; break;
      case "Space": game.pressJump(); e.preventDefault(); break;
      case "KeyX": case "ControlLeft": game.kickBall(); break;
      case "Escape":
        if (game.state === PLAYING || game.state === PAUSED) game.togglePause();
        break;
      case "KeyQ": if (game.state === PAUSED) game.state = MENU; break;
      case "Enter": game.confirm(); break;
    }
  });
  window.addEventListener("keyup", (e) => {
    switch (e.code) {
      case "ArrowLeft": case "KeyA": inp.left = false; break;
      case "ArrowRight": case "KeyD": inp.right = false; break;
      case "ShiftLeft": case "ShiftRight": inp.run = false; break;
      case "Space": game.releaseJump(); break;
    }
  });

  // Menus: tap/click on the canvas confirms.
  document.getElementById("game").addEventListener("pointerdown", () => {
    initAudio();
    if (game.state !== PLAYING && game.state !== PAUSED) game.confirm();
  });

  // Touch buttons. Moving runs automatically on mobile (no shift key).
  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    if (!el) return;
    const start = (e) => { e.preventDefault(); initAudio(); on(); };
    const end = (e) => { e.preventDefault(); if (off) off(); };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", end, { passive: false });
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointerleave", end);
  };
  hold("btn-left", () => { inp.left = true; inp.run = true; }, () => { inp.left = false; });
  hold("btn-right", () => { inp.right = true; inp.run = true; }, () => { inp.right = false; });
  hold("btn-jump", () => game.pressJump(), () => game.releaseJump());
  hold("btn-kick", () => game.kickBall(), null);
  hold("btn-pause", () => game.togglePause(), null);

  if (!IS_TOUCH) document.getElementById("touch-ui").style.display = "none";
  window.addEventListener("resize", fitCanvas);
}

function main() {
  const canvas = document.getElementById("game");
  canvas.width = S.WIDTH; canvas.height = S.HEIGHT;
  game = new Game(canvas);
  bindInputs();
  fitCanvas();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    game.time += dt;
    game.update(dt);
    game.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

loadSprites(main);
