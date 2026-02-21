const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');

const W = cvs.width;
const H = cvs.height;
const BLOCK = 36;
const TOP_CLEAR_ROWS = 7;
const cols = Math.floor(W / BLOCK);

const MAX_PARTICLES = 650;
const PRUNE_MARGIN_ROWS = 16;
const HIT_COOLDOWN = 0.19;
const MAX_IMPACTS = 14;

let blocks = [];
let particles = [];

function compactInPlace(arr, keep) {
  let w = 0;
  for (let r = 0; r < arr.length; r++) {
    const item = arr[r];
    if (keep(item)) arr[w++] = item;
  }
  arr.length = w;
}
let score = 0;
let camY = 0;
let camVel = 30;
let camBob = 0;
let shake = 0;
let t = 0;
let hitPulse = 0;
let hazardPulse = 0;
let lastHit = null;
let impactBursts = [];
let hitCooldown = 0;
let hitstop = 0;
let recoilX = 0;
let recoilY = 0;
let wasGrounded = false;
let generatedMaxRow = 0;
let landingPulse = 0;

const player = {
  x: W * 0.5,
  y: H * 0.43,
  face: 1,
  size: BLOCK * 2.1,
  swing: 0,
  glow: 0,
  trail: [],
};

function reset() {
  blocks = [];
  particles = [];
  score = 0;
  camY = 0;
  camVel = 30;
  camBob = 0;
  t = 0;
  impactBursts = [];
  hitCooldown = 0;
  hitstop = 0;
  recoilX = 0;
  recoilY = 0;
  wasGrounded = false;
  landingPulse = 0;
  generatedMaxRow = 259;
  for (let r = 0; r < 260; r++) addRow(r);
}

function addRow(r) {
  generatedMaxRow = Math.max(generatedMaxRow, r);
  for (let c = 0; c < cols; c++) {
    if (r < TOP_CLEAR_ROWS) continue;
    if (Math.random() < 0.15) continue;

    const p = Math.random();
    let type = 'normal', hp = 2;
    if (p > 0.92) { type = 'ore'; hp = 3; }
    else if (p > 0.80) { type = 'hard'; hp = 4; }
    else if (p > 0.73) { type = 'hazard'; hp = 2; }

    blocks.push({
      x: c * BLOCK,
      y: r * BLOCK,
      w: BLOCK - 2,
      h: BLOCK - 2,
      type,
      hp,
      maxHp: hp,
      flash: 0,
      blink: 0,
    });
  }
}

function pickaxeHeadPos() {
  const reach = player.size * 0.58;
  const base = player.face === 1 ? -0.48 : Math.PI + 0.48;
  const ang = base + player.swing * 1.15 * player.face;
  return {
    x: player.x + Math.cos(ang) * reach,
    y: player.y + Math.sin(ang) * reach,
    ang,
  };
}

function spawnDebris(x, y, type, power = 1, opts = {}) {
  const palette = {
    normal: '#d8dbe8',
    ore: '#57d3ff',
    hard: '#b88a64',
    hazard: '#ff6666',
    dust: '#c8d0df',
  };
  const color = palette[type] || '#ffffff';
  const n = 7 + Math.floor(power * 4);
  const baseAngle = opts.baseAngle ?? Math.random() * Math.PI * 2;
  const spread = opts.spread ?? Math.PI * 2;
  const downBoost = opts.downBoost ?? 0;
  for (let i = 0; i < n; i++) {
    const a = baseAngle + (Math.random() - 0.5) * spread;
    const s = (80 + Math.random() * 220) * (0.8 + power * 0.4);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s + downBoost,
      life: 0.25 + Math.random() * 0.4,
      color,
      size: 2 + Math.random() * 2.8,
    });
  }
  if (particles.length > MAX_PARTICLES) {
    particles.splice(0, particles.length - MAX_PARTICLES);
  }
}

function spawnImpactBurst(x, y, type, power = 1) {
  impactBursts.push({
    x,
    y,
    life: 0.22 + Math.min(0.12, power * 0.08),
    maxLife: 0.22 + Math.min(0.12, power * 0.08),
    power,
    strong: type === 'hazard' ? 1 : type === 'ore' ? 0.6 : 0,
  });
  if (impactBursts.length > MAX_IMPACTS) {
    impactBursts.splice(0, impactBursts.length - MAX_IMPACTS);
  }
}

function autoHit() {
  const head = pickaxeHeadPos();
  const radius = BLOCK * 0.85;
  let bestTarget = null;
  let bestDist = Infinity;
  let hitCount = 0;
  let strongestImpact = 0;

  for (const b of blocks) {
    const by = b.y - camY;
    if (by < -BLOCK || by > H + BLOCK) continue;

    const cx = b.x + b.w * 0.5;
    const cy = by + b.h * 0.5;
    const d = Math.hypot(cx - head.x, cy - head.y);
    if (d > radius) continue;

    if (d < bestDist) {
      bestDist = d;
      bestTarget = { x: cx, y: cy, type: b.type };
    }

    hitCount++;
    if (b.type === 'hazard') {
      b.flash = 0.18;
      const hitAng = Math.atan2(cy - head.y, cx - head.x);
      spawnDebris(cx, cy, 'hazard', 0.9, { baseAngle: hitAng, spread: Math.PI * 1.3, downBoost: camVel * 0.2 });
      spawnImpactBurst(cx, cy, 'hazard', 1.05);
      hazardPulse = 0.26;
      shake = Math.max(shake, 6);
      strongestImpact = Math.max(strongestImpact, 0.8);
      continue;
    }

    b.hp -= 1;
    b.flash = 0.12;
    if (b.hp === 1) b.blink = 0.35;

    const power = Math.max(0.7, 1.2 - d / radius);
    const hitAng = Math.atan2(cy - head.y, cx - head.x);
    spawnDebris(cx, cy, b.type, power, {
      baseAngle: hitAng,
      spread: Math.PI * 1.45,
      downBoost: camVel * 0.25,
    });
    spawnImpactBurst(cx, cy, b.type, power);

    if (b.hp <= 0) {
      score += b.type === 'ore' ? 55 : b.type === 'hard' ? 18 : 10;
      player.glow = 0.12;
      shake = Math.max(shake, 7 * power);
      spawnDebris(cx, cy, b.type, power * 1.2, {
        baseAngle: hitAng,
        spread: Math.PI * 0.9,
        downBoost: 80 + camVel * 0.45,
      });
      strongestImpact = Math.max(strongestImpact, 1.15 * power);
    } else {
      strongestImpact = Math.max(strongestImpact, 0.75 * power);
    }
  }

  compactInPlace(blocks, (b) => b.hp > 0);
  if (hitCount) {
    lastHit = {
      x: bestTarget ? bestTarget.x : head.x,
      y: bestTarget ? bestTarget.y : head.y,
      life: 0.22,
      strong: bestTarget && bestTarget.type === 'hazard' ? 1 : 0,
    };
    hitPulse = 0.18;
    hitstop = Math.max(hitstop, 0.028 + strongestImpact * 0.013);
    recoilX -= player.face * (4 + strongestImpact * 2.8);
    recoilY -= 1.4 + strongestImpact;
    player.trail.push({ x: head.x, y: head.y, life: 0.12 });
    if (player.trail.length > 8) player.trail.shift();
  }
}
function update(dt) {
  t += dt;
  const simDt = hitstop > 0 ? dt * 0.14 : dt;
  hitstop = Math.max(0, hitstop - dt);

  // 방치형 자동 플레이: 좌우 드리프트 + 주기적 방향전환
  player.x = W * 0.5 + Math.sin(t * 0.85) * (W * 0.28);
  player.face = Math.cos(t * 0.85) >= 0 ? 1 : -1;

  // 자동 스윙 리듬 (쿨다운 기반으로 일정한 타격감)
  player.swing = Math.max(0, player.swing - simDt * 5.8);
  hitCooldown -= simDt;
  if (hitCooldown <= 0) {
    hitCooldown = HIT_COOLDOWN + Math.random() * 0.02;
    player.swing = 1;
    autoHit();
  }

  // 카메라: 중력 기반 하강 + 타격 반동
  let support = 0;
  const probeY = camY + H * 0.62;
  for (const b of blocks) {
    const y = b.y - probeY;
    if (Math.abs(y) > BLOCK * 2.4) continue;
    const dx = Math.abs((b.x + b.w * 0.5) - player.x);
    if (dx < BLOCK * 1.7 && b.type !== 'hazard') support++;
  }
  const grounded = support >= 3;
  const dropFactor = Math.max(0, 1 - support / 5);
  const gravity = 120 + dropFactor * 230;
  const terminal = 84 + dropFactor * 180;
  camVel = Math.min(terminal, camVel + gravity * simDt);

  // 지지층을 밟고 있을 때는 낙하속도를 추가 감쇠해 “붙잡히는” 느낌 강화
  if (grounded) {
    const brake = 150 + Math.min(70, support * 12);
    camVel = Math.max(26, camVel - brake * simDt);
  }

  // 공중 -> 지면 전환 시 짧은 착지 임팩트
  if (grounded && !wasGrounded && camVel > 46) {
    const thud = Math.min(1, (camVel - 40) / 80);
    camBob += 14 + thud * 24;
    shake = Math.max(shake, 3 + thud * 5);
    landingPulse = Math.max(landingPulse, 0.26 + thud * 0.12);
    spawnDebris(player.x, H * 0.66, 'dust', 0.75 + thud * 0.55, {
      baseAngle: Math.PI * 0.5,
      spread: Math.PI * 0.7,
      downBoost: 20,
    });
  }
  wasGrounded = grounded;

  camBob = Math.max(0, camBob - simDt * 60);
  camY += (camVel - camBob) * simDt;

  // 블록 스트리밍 (행 인덱스 캐시로 전체 스캔 제거)
  const maxRow = Math.floor((camY + H * 2) / BLOCK);
  for (let r = generatedMaxRow + 1; r <= maxRow; r++) addRow(r);

  // 오래된 블록 정리(성능)
  const pruneY = camY - BLOCK * PRUNE_MARGIN_ROWS;
  compactInPlace(blocks, (b) => b.y + b.h > pruneY);

  // VFX 업데이트
  player.glow = Math.max(0, player.glow - simDt * 2.4);
  hitPulse = Math.max(0, hitPulse - simDt * 4.5);
  hazardPulse = Math.max(0, hazardPulse - simDt * 3.5);
  landingPulse = Math.max(0, landingPulse - simDt * 3.2);
  for (const tr of player.trail) tr.life -= simDt;
  compactInPlace(player.trail, (tr) => tr.life > 0);

  recoilX *= Math.pow(0.0008, simDt);
  recoilY *= Math.pow(0.0008, simDt);

  for (const b of blocks) {
    b.flash = Math.max(0, b.flash - simDt * 2.8);
    b.blink = Math.max(0, b.blink - simDt);
  }

  if (lastHit) {
    lastHit.life -= simDt;
    if (lastHit.life <= 0) lastHit = null;
  }

  for (const ib of impactBursts) ib.life -= simDt;
  impactBursts = impactBursts.filter((ib) => ib.life > 0);

  for (const p of particles) {
    p.life -= simDt;
    p.x += p.vx * simDt;
    p.y += p.vy * simDt;
    p.vy += 520 * simDt;
    p.vx *= Math.pow(0.22, simDt);
  }
  compactInPlace(particles, (p) => p.life > 0);

  shake = Math.max(0, shake - simDt * 20);
}

function drawPickaxe(ox, oy) {
  const s = player.size;
  const x = player.x + ox + recoilX;
  const y = player.y + oy + recoilY;
  const len = s * 0.84;
  const ang = (player.face === 1 ? -0.30 : Math.PI + 0.30) + player.swing * 0.72 * player.face;

  const hx = x - Math.cos(ang) * len * 0.48;
  const hy = y - Math.sin(ang) * len * 0.48;
  const tx = x + Math.cos(ang) * len * 0.48;
  const ty = y + Math.sin(ang) * len * 0.48;

  // 곡괭이 실루엣 대비용 백플레이트
  const backR = s * (0.58 + player.swing * 0.14);
  const backG = ctx.createRadialGradient(x, y, 6, x, y, backR);
  backG.addColorStop(0, 'rgba(5,8,16,0.55)');
  backG.addColorStop(1, 'rgba(5,8,16,0)');
  ctx.fillStyle = backG;
  ctx.beginPath();
  ctx.arc(x, y, backR, 0, Math.PI * 2);
  ctx.fill();

  // 스윙 궤적(타격 타이밍 가시화)
  if (player.swing > 0.02) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const arcR = s * 0.66;
    const arcWidth = 9 + player.swing * 6;
    const arcG = ctx.createLinearGradient(0, -arcR, 0, arcR);
    arcG.addColorStop(0, 'rgba(255,250,220,0)');
    arcG.addColorStop(0.5, `rgba(255,226,145,${0.24 + player.swing * 0.28})`);
    arcG.addColorStop(1, 'rgba(141,216,255,0)');
    ctx.strokeStyle = arcG;
    ctx.lineWidth = arcWidth;
    ctx.beginPath();
    ctx.arc(0, 0, arcR, -0.92, 0.56);
    ctx.stroke();
    ctx.restore();
  }

  // 타격 방향 가이드(전방 콘)
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const coneLen = s * 0.92;
  const coneW = s * 0.35;
  const coneG = ctx.createLinearGradient(0, 0, coneLen, 0);
  coneG.addColorStop(0, 'rgba(141,216,255,0)');
  coneG.addColorStop(1, 'rgba(141,216,255,0.32)');
  ctx.fillStyle = coneG;
  ctx.beginPath();
  ctx.moveTo(s * 0.12, -coneW * 0.45);
  ctx.lineTo(coneLen, 0);
  ctx.lineTo(s * 0.12, coneW * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 잔상(헤드 끝 위주)
  for (let i = player.trail.length - 1; i >= 0; i--) {
    const tr = player.trail[i];
    ctx.globalAlpha = tr.life * 3;
    ctx.fillStyle = '#8dd8ff';
    ctx.beginPath();
    ctx.arc(tr.x + ox, tr.y + oy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 손잡이 외곽(실루엣 강화)
  ctx.strokeStyle = '#1b110b';
  ctx.lineWidth = 15;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  // 손잡이 본체
  ctx.strokeStyle = '#8a5a34';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  const headX = x + Math.cos(ang) * len * 0.42;
  const headY = y + Math.sin(ang) * len * 0.42;

  // 헤드 글로우
  if (player.glow > 0 || hitPulse > 0) {
    const pulse = Math.max(player.glow, hitPulse * 0.8);
    const r = 20 + pulse * 24;
    const grd = ctx.createRadialGradient(headX, headY, 2, headX, headY, r);
    grd.addColorStop(0, 'rgba(255,240,170,0.95)');
    grd.addColorStop(1, 'rgba(255,240,170,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(headX, headY, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 곡괭이 헤드
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(ang);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;

  // 헤드 외곽 실루엣
  ctx.strokeStyle = '#0d131f';
  ctx.lineWidth = 5;

  // 금속 중앙 바(손잡이 결합부)
  ctx.fillStyle = '#c2cfdd';
  ctx.fillRect(-s * 0.06, -s * 0.20, s * 0.12, s * 0.34);
  ctx.strokeRect(-s * 0.06, -s * 0.20, s * 0.12, s * 0.34);

  // 좌측 뾰족 픽
  ctx.fillStyle = '#dce7f2';
  ctx.beginPath();
  ctx.moveTo(-s * 0.06, -s * 0.12);
  ctx.lineTo(-s * 0.42, -s * 0.22);
  ctx.lineTo(-s * 0.52, -s * 0.02);
  ctx.lineTo(-s * 0.08, s * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 우측 평날(애드즈)
  ctx.beginPath();
  ctx.moveTo(s * 0.06, -s * 0.12);
  ctx.lineTo(s * 0.50, -s * 0.08);
  ctx.lineTo(s * 0.46, s * 0.08);
  ctx.lineTo(s * 0.04, s * 0.10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 전방 포인터(방향성 강조)
  ctx.fillStyle = '#ffd887';
  ctx.beginPath();
  ctx.moveTo(s * 0.55, 0);
  ctx.lineTo(s * 0.70, -s * 0.05);
  ctx.lineTo(s * 0.70, s * 0.05);
  ctx.closePath();
  ctx.fill();

  // 하이라이트
  ctx.strokeStyle = '#f1f7ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-s * 0.40, -s * 0.16);
  ctx.lineTo(-s * 0.16, -s * 0.10);
  ctx.moveTo(s * 0.18, -s * 0.05);
  ctx.lineTo(s * 0.42, -s * 0.03);
  ctx.stroke();

  ctx.restore();
}
function draw() {
  // 배경
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a2446');
  g.addColorStop(1, '#0a1020');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 지상
  const groundH = Math.max(0, TOP_CLEAR_ROWS * BLOCK - camY + 8);
  if (groundH > 0) {
    ctx.fillStyle = '#24385f';
    ctx.fillRect(0, 0, W, groundH);
    ctx.fillStyle = '#3e5e8f';
    ctx.fillRect(0, groundH - 4, W, 4);
  }

  const ox = shake ? (Math.random() * 2 - 1) * shake : 0;
  const oy = shake ? (Math.random() * 2 - 1) * shake : 0;

  // 하강 속도선: 물리적 낙하 체감 강화
  const speedN = Math.max(0, Math.min(1, (camVel - 52) / 180));
  if (speedN > 0.02) {
    ctx.strokeStyle = `rgba(157, 204, 255, ${0.05 + speedN * 0.14})`;
    ctx.lineWidth = 1 + speedN * 1.2;
    for (let i = 0; i < 14; i++) {
      const sx = ((i * 67 + t * 120) % (W + 80)) - 40;
      const sy = ((i * 103 + t * 340) % (H + 120)) - 60;
      const len = 10 + speedN * 26;
      ctx.beginPath();
      ctx.moveTo(sx + ox * 0.2, sy + oy * 0.2);
      ctx.lineTo(sx + ox * 0.2, sy + len + oy * 0.2);
      ctx.stroke();
    }
  }

  // 블록 렌더
  for (const b of blocks) {
    const y = b.y - camY + oy;
    if (y < -BLOCK || y > H + BLOCK) continue;

    let col = '#6d7892';
    if (b.type === 'ore') col = '#2bafea';
    if (b.type === 'hard') col = '#8f6748';
    if (b.type === 'hazard') col = '#b64040';

    if (b.flash > 0) col = '#ffd887';
    if (b.blink > 0 && Math.floor(b.blink * 30) % 2 === 0) col = '#ffca74';

    const bx = b.x + ox;
    ctx.fillStyle = col;
    ctx.fillRect(bx, y, b.w, b.h);

    // 외곽선/하이라이트로 블록 대비 강화
    ctx.strokeStyle = 'rgba(9,13,22,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, y + 1, b.w - 2, b.h - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(bx + 3, y + 3, b.w - 10, 3);

    // 크랙
    const ratio = b.hp / b.maxHp;
    if (ratio < 1 && b.type !== 'hazard') {
      ctx.strokeStyle = '#151a28';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x + 8 + ox, y + 8);
      ctx.lineTo(b.x + b.w - 8 + ox, y + b.h - 8);
      if (ratio < 0.67) {
        ctx.moveTo(b.x + 12 + ox, y + b.h - 10);
        ctx.lineTo(b.x + b.w - 12 + ox, y + 10);
      }
      ctx.stroke();
    }
  }

  // 파티클
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life * 2.2);
    ctx.fillStyle = p.color;
    const sz = p.size || 3;
    ctx.fillRect(p.x + ox, p.y + oy, sz, sz);
  }
  ctx.globalAlpha = 1;


  // 피격 피드백(다중 임팩트 링 + 스파크)
  for (const ib of impactBursts) {
    const lifeN = Math.max(0, ib.life / ib.maxLife);
    const bloom = (1 - lifeN);
    const baseR = 10 + bloom * (20 + ib.power * 9);
    const hitColor = ib.strong > 0.8 ? '255,92,92' : ib.strong > 0.2 ? '99,221,255' : '255,216,135';

    ctx.globalAlpha = 0.88 * lifeN;
    ctx.strokeStyle = `rgba(${hitColor}, ${0.25 + lifeN * 0.55})`;
    ctx.lineWidth = 2 + ib.power * 2;
    ctx.beginPath();
    ctx.arc(ib.x + ox, ib.y + oy, baseR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.65 * lifeN;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI * 2 * i) / 6 + t * 7.5;
      const sx = ib.x + ox + Math.cos(ang) * (baseR - 5);
      const sy = ib.y + oy + Math.sin(ang) * (baseR - 5);
      const ex = ib.x + ox + Math.cos(ang) * (baseR + 10 + ib.power * 5);
      const ey = ib.y + oy + Math.sin(ang) * (baseR + 10 + ib.power * 5);
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (lastHit) {
    const a = Math.min(1, lastHit.life * 5);
    const r = 22 + (1 - a) * 34;
    const glow = ctx.createRadialGradient(lastHit.x + ox, lastHit.y + oy, 2, lastHit.x + ox, lastHit.y + oy, r);
    glow.addColorStop(0, lastHit.strong ? 'rgba(255,92,92,0.44)' : 'rgba(255,216,135,0.40)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lastHit.x + ox, lastHit.y + oy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawPickaxe(ox, oy);

  // 피격 경고(해저드)
  if (hazardPulse > 0) {
    ctx.fillStyle = `rgba(255, 82, 82, ${hazardPulse * 0.28})`;
    ctx.fillRect(0, 0, W, H);
  }

  // 착지 충격 비네트
  if (landingPulse > 0) {
    const lg = ctx.createRadialGradient(W * 0.5, H * 0.7, 20, W * 0.5, H * 0.7, H * 0.9);
    lg.addColorStop(0, `rgba(255,220,150,${landingPulse * 0.12})`);
    lg.addColorStop(1, `rgba(0,0,0,${landingPulse * 0.22})`);
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);
  }

  // HUD (가독성 강화)
  ctx.fillStyle = 'rgba(8,10,16,.72)';
  ctx.fillRect(12, 12, W - 24, 74);
  ctx.fillStyle = '#eaf0ff';
  ctx.font = 'bold 20px system-ui';
  ctx.fillText(`SCORE ${score}`, 24, 38);

  const depth = Math.floor(camY / BLOCK);
  ctx.font = '14px system-ui';
  ctx.fillStyle = '#c5d1ef';
  ctx.fillText(`DEPTH ${depth}m`, 24, 60);
  ctx.fillStyle = '#9fb0d8';
  ctx.fillText('AUTO IDLE SHOWCASE', W - 182, 60);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

reset();
requestAnimationFrame(loop);
nimationFrame(loop);
