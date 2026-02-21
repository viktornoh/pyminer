const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');

const W = cvs.width, H = cvs.height;
const BLOCK = 36;
const TOP_CLEAR_ROWS = 5;
const cols = Math.floor(W / BLOCK);

let keys = {};
let blocks = [];
let particles = [];
let score = 0;
let hp = 5;
let over = false;

const player = {
  x: W * 0.5,
  y: H * 0.42,
  vx: 0,
  swing: 0,
  swingCd: 0,
  face: 1,
  size: BLOCK * 2.0, // 블록 대비 약 2배
};

let camY = 0;
let descend = 26; // 과한 하강감 줄임
let t0 = performance.now();

function reset() {
  blocks = [];
  particles = [];
  score = 0;
  hp = 5;
  over = false;
  player.x = W * 0.5;
  player.swing = 0;
  player.swingCd = 0;
  camY = 0;
  t0 = performance.now();
  for (let r = 0; r < 240; r++) addRow(r);
}

function addRow(r) {
  for (let c = 0; c < cols; c++) {
    if (r < TOP_CLEAR_ROWS) continue; // 맨 윗층은 지상 느낌(빈 공간)
    if (Math.random() < 0.14) continue;
    const p = Math.random();
    let type = 'normal', hp = 2;
    if (p > 0.92) { type = 'ore'; hp = 3; }
    else if (p > 0.8) { type = 'hard'; hp = 4; }
    else if (p > 0.72) { type = 'hazard'; hp = 2; }
    blocks.push({
      x: c * BLOCK,
      y: r * BLOCK,
      w: BLOCK - 2,
      h: BLOCK - 2,
      type,
      hp,
      maxHp: hp,
      flash: 0,
    });
  }
}

function spawnDebris(x, y, color, n=8) {
  for (let i=0;i<n;i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 220;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.35+Math.random()*0.3,color});
  }
}

function pickaxeHeadPos() {
  const reach = player.size * 0.55;
  const ang = (player.face === 1 ? -0.45 : Math.PI + 0.45) + player.swing * 1.1 * player.face;
  return {
    x: player.x + Math.cos(ang) * reach,
    y: player.y + Math.sin(ang) * reach,
  };
}

function hitTestSwing() {
  const head = pickaxeHeadPos();
  const r = BLOCK * 0.75;
  for (const b of blocks) {
    const by = b.y - camY;
    if (by < -BLOCK || by > H + BLOCK) continue;
    const cx = b.x + b.w * 0.5;
    const cy = by + b.h * 0.5;
    const d = Math.hypot(cx - head.x, cy - head.y);
    if (d <= r) {
      if (b.type === 'hazard') {
        hp -= 1;
        b.flash = 0.2;
        spawnDebris(cx, cy, '#ff5b5b', 12);
      } else {
        b.hp -= 1;
        b.flash = 0.12;
        spawnDebris(cx, cy, b.type === 'ore' ? '#49c9ff' : '#d8d8d8', 7);
        if (b.hp <= 0) score += b.type === 'ore' ? 45 : (b.type === 'hard' ? 18 : 10);
      }
    }
  }
  blocks = blocks.filter(b => b.hp > 0);
}

function update(dt) {
  if (over) return;

  // 이동
  const speed = 280;
  player.vx = 0;
  if (keys['a'] || keys['arrowleft']) { player.vx = -speed; player.face = -1; }
  if (keys['d'] || keys['arrowright']) { player.vx = speed; player.face = 1; }
  player.x += player.vx * dt;
  player.x = Math.max(26, Math.min(W - 26, player.x));

  // 과도한 자동 하강 방지(천천히)
  camY += descend * dt;

  // 스윙
  if (player.swingCd > 0) player.swingCd -= dt;
  if (keys[' '] && player.swingCd <= 0) {
    player.swing = 1;
    player.swingCd = 0.34;
    hitTestSwing();
  }
  player.swing = Math.max(0, player.swing - dt * 5.3);

  // 블록 확장
  const maxRow = Math.floor((camY + H * 2) / BLOCK);
  let curMax = 0;
  for (const b of blocks) curMax = Math.max(curMax, Math.floor(b.y / BLOCK));
  for (let r = curMax + 1; r <= maxRow; r++) addRow(r);

  // 파티클
  for (const p of particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 420 * dt;
  }
  particles = particles.filter(p => p.life > 0);

  for (const b of blocks) b.flash = Math.max(0, b.flash - dt);

  if (hp <= 0) over = true;
}

function drawPickaxe() {
  const s = player.size;
  const x = player.x, y = player.y;

  // 손잡이
  const len = s * 0.75;
  const ang = (player.face === 1 ? -0.28 : Math.PI + 0.28) + player.swing * 0.7 * player.face;
  const hx = x - Math.cos(ang) * len * 0.45;
  const hy = y - Math.sin(ang) * len * 0.45;
  const tx = x + Math.cos(ang) * len * 0.45;
  const ty = y + Math.sin(ang) * len * 0.45;
  ctx.strokeStyle = '#8a5a34';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  // 헤드(곡괭이 실루엣)
  const headX = x + Math.cos(ang) * len * 0.38;
  const headY = y + Math.sin(ang) * len * 0.38;
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(ang);
  ctx.fillStyle = '#c8d6e5';
  ctx.beginPath();
  ctx.moveTo(-s*0.34, -s*0.05);
  ctx.quadraticCurveTo(0, -s*0.24, s*0.34, -s*0.05);
  ctx.lineTo(s*0.18, s*0.08);
  ctx.lineTo(-s*0.18, s*0.08);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#9fb3c8';
  ctx.beginPath();
  ctx.moveTo(-s*0.28, -s*0.03);
  ctx.lineTo(-s*0.44, s*0.12);
  ctx.lineTo(-s*0.18, s*0.09);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function draw() {
  // 배경
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#1a2240');
  g.addColorStop(1,'#0c1020');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  // 지상 영역
  ctx.fillStyle = '#213255';
  ctx.fillRect(0,0,W,TOP_CLEAR_ROWS*BLOCK - camY + 8);

  // 블록
  for (const b of blocks) {
    const y = b.y - camY;
    if (y < -BLOCK || y > H + BLOCK) continue;
    let col = '#6f7a8f';
    if (b.type === 'ore') col = '#2aa9e0';
    if (b.type === 'hard') col = '#8a6749';
    if (b.type === 'hazard') col = '#b63e3e';
    if (b.flash > 0) col = '#ffd67a';
    ctx.fillStyle = col;
    ctx.fillRect(b.x, y, b.w, b.h);

    // 균열
    const ratio = b.hp / b.maxHp;
    if (ratio < 1 && b.type !== 'hazard') {
      ctx.strokeStyle = '#10131f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x+6, y+8); ctx.lineTo(b.x+b.w-7, y+b.h-9);
      if (ratio < 0.67) { ctx.moveTo(b.x+10, y+b.h-10); ctx.lineTo(b.x+b.w-12, y+10); }
      ctx.stroke();
    }
  }

  // 파티클
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / 0.65);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.globalAlpha = 1;

  drawPickaxe();

  // HUD
  ctx.fillStyle = 'rgba(10,12,20,0.65)';
  ctx.fillRect(10,10,W-20,68);
  ctx.fillStyle = '#e8edff';
  ctx.font = 'bold 20px system-ui';
  ctx.fillText(`SCORE ${score}`, 20, 34);
  ctx.fillText(`HP ${'♥'.repeat(Math.max(hp,0))}`, 20, 60);
  const sec = Math.floor((performance.now()-t0)/1000);
  ctx.fillText(`TIME ${sec}s`, W-140, 34);

  if (over) {
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#ff8080';
    ctx.font = 'bold 36px system-ui';
    ctx.fillText('GAME OVER', W/2-110, H/2-8);
    ctx.font = '18px system-ui';
    ctx.fillStyle = '#f2f4ff';
    ctx.fillText('R 키로 재시작', W/2-58, H/2+24);
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') e.preventDefault();
  if ((e.key === 'r' || e.key === 'R') && over) reset();
});
window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

reset();
requestAnimationFrame(loop);
