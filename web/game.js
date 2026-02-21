const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');

const W = cvs.width;
const H = cvs.height;
const BLOCK = 36;
const TOP_CLEAR_ROWS = 7;
const cols = Math.floor(W / BLOCK);

let bgGradient = null;
let baseVignette = null;

const MAX_PARTICLES = 650;
const PRUNE_MARGIN_ROWS = 16;
const HIT_COOLDOWN = 0.19;
const SWING_DURATION = 0.20;
const SWING_IMPACT_PHASE = 0.46;
const MAX_IMPACTS = 14;
const MAX_SLASH_MARKS = 18;

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

function decayAndCompactInPlace(arr, dt, lifeKey = 'life') {
  let w = 0;
  for (let r = 0; r < arr.length; r++) {
    const item = arr[r];
    item[lifeKey] -= dt;
    if (item[lifeKey] > 0) arr[w++] = item;
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
let slashMarks = [];
let hitCooldown = 0;
let hitstop = 0;
let recoilX = 0;
let recoilY = 0;
let wasGrounded = false;
let generatedMaxRow = 0;
let landingPulse = 0;
let comboPulse = 0;
let fallStress = 0;
let airRumble = 0;
let frameMsAvg = 16.7;
let preImpactPulse = 0;
let groundGrip = 0;
let groundLatch = 0;
let headFocusPulse = 0;
let impactFlash = 0;
let impactStreak = 0;
let freefallChain = 0;
let dropSurge = 0;
let collisionSpring = 0;
let collisionSpringVel = 0;

function initVisualCache() {
  if (!bgGradient) {
    bgGradient = ctx.createLinearGradient(0, 0, 0, H);
    bgGradient.addColorStop(0, '#1a2446');
    bgGradient.addColorStop(1, '#0a1020');
  }

  if (!baseVignette) {
    baseVignette = ctx.createRadialGradient(W * 0.5, H * 0.44, H * 0.18, W * 0.5, H * 0.5, H * 0.86);
    baseVignette.addColorStop(0, 'rgba(0,0,0,0)');
    baseVignette.addColorStop(1, 'rgba(1,3,8,0.42)');
  }
}

const player = {
  x: W * 0.5,
  y: H * 0.43,
  face: 1,
  size: BLOCK * 2.1,
  swing: 0,
  swingPhase: 1,
  swingHitDone: true,
  glow: 0,
  trail: [],
};

function reset() {
  initVisualCache();
  blocks = [];
  particles = [];
  score = 0;
  camY = 0;
  camVel = 30;
  camBob = 0;
  t = 0;
  impactBursts = [];
  slashMarks = [];
  hitCooldown = 0;
  hitstop = 0;
  recoilX = 0;
  recoilY = 0;
  wasGrounded = false;
  landingPulse = 0;
  comboPulse = 0;
  fallStress = 0;
  airRumble = 0;
  preImpactPulse = 0;
  groundGrip = 0;
  groundLatch = 0;
  headFocusPulse = 0;
  impactFlash = 0;
  impactStreak = 0;
  freefallChain = 0;
  dropSurge = 0;
  collisionSpring = 0;
  collisionSpringVel = 0;
  frameMsAvg = 16.7;
  player.swing = 0;
  player.swingPhase = 1;
  player.swingHitDone = true;
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
  const reach = player.size * (0.56 + Math.max(0, player.swing) * 0.05);
  const base = player.face === 1 ? -0.48 : Math.PI + 0.48;
  const ang = base + player.swing * 1.22 * player.face;
  return {
    x: player.x + Math.cos(ang) * reach,
    y: player.y + Math.sin(ang) * reach,
    ang,
  };
}

const DEBRIS_COLORS = {
  normal: '#d8dbe8',
  ore: '#57d3ff',
  hard: '#b88a64',
  hazard: '#ff6666',
  dust: '#c8d0df',
};

const BLOCK_COLORS = {
  normal: '#6d7892',
  ore: '#2bafea',
  hard: '#8f6748',
  hazard: '#b64040',
};

function spawnDebris(x, y, type, power = 1, opts = {}) {
  const color = DEBRIS_COLORS[type] || '#ffffff';
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

function spawnSlashMark(x, y, ang, power = 1, strong = 0) {
  slashMarks.push({
    x,
    y,
    ang,
    power,
    strong,
    life: 0.14 + Math.min(0.08, power * 0.03),
    maxLife: 0.14 + Math.min(0.08, power * 0.03),
  });
  if (slashMarks.length > MAX_SLASH_MARKS) {
    slashMarks.splice(0, slashMarks.length - MAX_SLASH_MARKS);
  }
}

function autoHit() {
  const head = pickaxeHeadPos();
  const radius = BLOCK * 0.85;
  let bestTarget = null;
  let bestDist = Infinity;
  let hitCount = 0;
  let strongestImpact = 0;
  let blocksNeedCompact = false;

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
      blocksNeedCompact = true;
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

  if (blocksNeedCompact) compactInPlace(blocks, (b) => b.hp > 0);
  if (hitCount) {
    const markX = bestTarget ? bestTarget.x : head.x;
    const markY = bestTarget ? bestTarget.y : head.y;
    const markStrong = bestTarget && bestTarget.type === 'hazard' ? 1 : strongestImpact > 0.9 ? 0.55 : 0.2;

    lastHit = {
      x: markX,
      y: markY,
      life: 0.22,
      strong: bestTarget && bestTarget.type === 'hazard' ? 1 : 0,
    };
    hitPulse = 0.18;
    hitstop = Math.max(hitstop, 0.028 + strongestImpact * 0.013);
    recoilX -= player.face * (4 + strongestImpact * 2.8);
    recoilY -= 1.4 + strongestImpact;
    player.trail.push({ x: head.x, y: head.y, life: 0.12 });
    if (player.trail.length > 8) player.trail.shift();
    spawnSlashMark(markX, markY, head.ang, strongestImpact, markStrong);
    comboPulse = Math.min(1, comboPulse + Math.min(0.34, hitCount * 0.08));
    impactStreak = Math.min(1, impactStreak + Math.min(0.26, hitCount * 0.07));
    headFocusPulse = Math.min(1, headFocusPulse + 0.34 + strongestImpact * 0.24 + impactStreak * 0.14);
    impactFlash = Math.min(1, impactFlash + 0.18 + strongestImpact * 0.22 + impactStreak * 0.08);
  }
}
function swingValueFromPhase(phase) {
  const p = Math.max(0, Math.min(1, phase));
  if (p < 0.24) {
    const k = p / 0.24;
    return -0.24 * (k * k);
  }
  if (p < SWING_IMPACT_PHASE) {
    const k = (p - 0.24) / (SWING_IMPACT_PHASE - 0.24);
    const eased = 1 - Math.pow(1 - k, 3);
    return -0.24 + eased * 1.29;
  }
  const k = (p - SWING_IMPACT_PHASE) / (1 - SWING_IMPACT_PHASE);
  const eased = 1 - Math.pow(1 - k, 2.1);
  return 1.05 * (1 - eased);
}

function update(dt) {
  t += dt;
  const simDt = hitstop > 0 ? dt * 0.14 : dt;
  hitstop = Math.max(0, hitstop - dt);

  // 프레임 내에서 반복되는 감쇠 계산 캐시(파티클 수가 많을 때 비용 절감)
  const recoilDamping = Math.pow(0.0008, simDt);
  const particleDrag = Math.pow(0.22, simDt);

  // 방치형 자동 플레이: 좌우 드리프트 + 주기적 방향전환
  player.x = W * 0.5 + Math.sin(t * 0.85) * (W * 0.28);
  player.face = Math.cos(t * 0.85) >= 0 ? 1 : -1;

  // 자동 스윙 리듬: 백스윙 -> 임팩트 -> 팔로우스루 곡선으로 타격 모션 개선
  hitCooldown -= simDt;
  if (hitCooldown <= 0) {
    hitCooldown = HIT_COOLDOWN + Math.random() * 0.02;
    player.swingPhase = 0;
    player.swingHitDone = false;
  }

  player.swingPhase = Math.min(1, player.swingPhase + simDt / SWING_DURATION);
  player.swing = swingValueFromPhase(player.swingPhase);
  if (!player.swingHitDone && player.swingPhase >= SWING_IMPACT_PHASE) {
    player.swingHitDone = true;
    autoHit();
  }

  // 카메라: 중력 기반 하강 + 타격 반동
  let support = 0;
  let futureSupport = 0;
  const probeY = camY + H * 0.62;
  const futureProbeY = probeY + Math.min(BLOCK * 1.4, camVel * 0.2);
  for (const b of blocks) {
    if (b.type === 'hazard') continue;

    const centerX = b.x + b.w * 0.5;
    const dx = Math.abs(centerX - player.x);
    if (dx < BLOCK * 1.7) {
      const y = b.y - probeY;
      if (Math.abs(y) <= BLOCK * 2.4) support++;
    }

    if (dx < BLOCK * 2.05) {
      const fy = b.y - futureProbeY;
      if (Math.abs(fy) <= BLOCK * 2.8) futureSupport++;
    }
  }
  // 지면 판정 히스테리시스: 프레임 단위 미세 흔들림으로 인한 착지/공중 깜빡임 억제
  const supportN = Math.min(1, support / 4);
  if (support >= 3) {
    groundLatch = Math.min(1, groundLatch + simDt * (4.8 + supportN * 2.6));
  } else {
    const release = support <= 0 ? 4.2 : 2.7;
    groundLatch = Math.max(0, groundLatch - simDt * release);
  }
  const grounded = groundLatch > 0.34;
  const dropFactor = Math.max(0, 1 - support / 5);

  // 위→아래 중력 체감 강화: 공중 체류가 길수록 하강이 더 강해지는 연쇄 가속
  if (!grounded) {
    freefallChain = Math.min(1, freefallChain + simDt * (1.2 + dropFactor * 0.9));
  } else {
    freefallChain = Math.max(0, freefallChain - simDt * 5.2);
  }

  const gravity = 142 + dropFactor * 292 + freefallChain * 88;
  const terminal = 96 + dropFactor * 212 + freefallChain * 58;
  const preBrakeVel = Math.min(terminal, camVel + gravity * simDt);
  camVel = preBrakeVel;

  // 착지 직전 예고 펄스: 다음 프레임 지면 충돌 예측 시 짧은 긴장감 부여
  if (!grounded && futureSupport >= 3 && camVel > 54) {
    const imminence = Math.min(1, (camVel - 50) / 120);
    preImpactPulse = Math.max(preImpactPulse, 0.09 + imminence * 0.18);
    shake = Math.max(shake, 0.8 + imminence * 2.1);
  }

  // 공중 낙하 누적 압력(빠르게 떨어질수록 불안정 + 착지 강도 누적)
  if (!grounded) {
    const stressGain = Math.max(0, (camVel - 54) / 172);
    fallStress = Math.min(1, fallStress + stressGain * simDt * 2.8);
    airRumble = Math.max(airRumble, stressGain * 0.9);
    dropSurge = Math.min(1, dropSurge + simDt * (0.9 + stressGain * 1.8));
  }

  // 지지층을 밟고 있을 때는 낙하속도를 추가 감쇠해 “붙잡히는” 느낌 강화
  if (grounded) {
    groundGrip = Math.min(1, groundGrip + simDt * 4.8);
    const brake = 156 + Math.min(82, support * 13);
    const gripBrake = brake * (1 + groundGrip * 0.24);
    camVel = Math.max(25, camVel - gripBrake * simDt);
    dropSurge = Math.max(0, dropSurge - simDt * 4.6);
  } else {
    groundGrip = Math.max(0, groundGrip - simDt * 5.5);
  }

  // 공중 -> 지면 전환 시 짧은 착지 임팩트 (브레이크 적용 전 속도로 계산)
  if (grounded && !wasGrounded && preBrakeVel > 44) {
    const thud = Math.min(1, (preBrakeVel - 38) / 84);
    const charged = Math.min(1, thud * 0.75 + fallStress * 0.65);
    camBob += 16 + charged * 30;
    camVel = Math.max(28, camVel - (8 + charged * 22));
    shake = Math.max(shake, 3 + charged * 7);
    landingPulse = Math.max(landingPulse, 0.28 + charged * 0.16);
    recoilY += 1.5 + charged * 3.8;
    comboPulse = Math.min(1, comboPulse + charged * 0.4);

    // 착지 순간 카메라-스프링 반동: 눌림 -> 되튐을 짧게 보여 충돌 질량감 강화
    const impactImpulse = 12 + charged * 18 + Math.max(0, preBrakeVel - 42) * 0.05;
    collisionSpringVel += impactImpulse;
    collisionSpring -= 1.2 + charged * 1.8;

    spawnDebris(player.x, H * 0.66, 'dust', 0.78 + charged * 0.7, {
      baseAngle: Math.PI * 0.5,
      spread: Math.PI * 0.7,
      downBoost: 20,
    });
    fallStress *= 0.35;
  }
  wasGrounded = grounded;

  // 1차 감쇠 스프링으로 착지 후 미세 흔들림(과한 랜덤 쉐이크 대체 보강)
  collisionSpringVel += (-collisionSpring * 158 - collisionSpringVel * 22) * simDt;
  collisionSpring += collisionSpringVel * simDt;
  if (Math.abs(collisionSpring) < 0.02 && Math.abs(collisionSpringVel) < 0.05) {
    collisionSpring = 0;
    collisionSpringVel = 0;
  }

  camBob = Math.max(0, camBob - simDt * 60);
  const surgeBoost = !grounded ? (1 + dropSurge * 0.16) : 1;
  camY += (camVel * surgeBoost - camBob) * simDt;

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
  preImpactPulse = Math.max(0, preImpactPulse - simDt * 4.4);
  comboPulse = Math.max(0, comboPulse - simDt * 1.8);
  impactStreak = Math.max(0, impactStreak - simDt * 1.35);
  headFocusPulse = Math.max(0, headFocusPulse - simDt * 3.4);
  impactFlash = Math.max(0, impactFlash - simDt * 7.6);
  fallStress = Math.max(0, fallStress - simDt * (grounded ? 1.9 : 0.35));
  airRumble = Math.max(0, airRumble - simDt * 2.4);
  decayAndCompactInPlace(player.trail, simDt);

  recoilX *= recoilDamping;
  recoilY *= recoilDamping;

  for (const b of blocks) {
    b.flash = Math.max(0, b.flash - simDt * 2.8);
    b.blink = Math.max(0, b.blink - simDt);
  }

  if (lastHit) {
    lastHit.life -= simDt;
    if (lastHit.life <= 0) lastHit = null;
  }

  decayAndCompactInPlace(impactBursts, simDt);
  decayAndCompactInPlace(slashMarks, simDt);

  for (const p of particles) {
    p.life -= simDt;
    p.x += p.vx * simDt;
    p.y += p.vy * simDt;
    p.vy += 520 * simDt;
    p.vx *= particleDrag;
  }
  compactInPlace(particles, (p) => p.life > 0);

  if (!grounded && airRumble > 0.05) {
    shake = Math.max(shake, 0.8 + airRumble * 2.2);
  }
  shake = Math.max(0, shake - simDt * 20);
}

function drawPickaxe(ox, oy) {
  const s = player.size;
  const x = player.x + ox + recoilX;
  const y = player.y + oy + recoilY;
  const len = s * (0.82 + Math.max(0, player.swing) * 0.06);
  const ang = (player.face === 1 ? -0.30 : Math.PI + 0.30) + player.swing * 0.80 * player.face;

  const hx = x - Math.cos(ang) * len * 0.48;
  const hy = y - Math.sin(ang) * len * 0.48;
  const tx = x + Math.cos(ang) * len * 0.48;
  const ty = y + Math.sin(ang) * len * 0.48;

  // 곡괭이 실루엣 대비용 백플레이트
  const backR = s * (0.58 + player.swing * 0.14 + headFocusPulse * 0.09);
  const backG = ctx.createRadialGradient(x, y, 6, x, y, backR);
  backG.addColorStop(0, 'rgba(5,8,16,0.60)');
  backG.addColorStop(1, 'rgba(5,8,16,0)');
  ctx.fillStyle = backG;
  ctx.beginPath();
  ctx.arc(x, y, backR, 0, Math.PI * 2);
  ctx.fill();

  // 타격 직후 실루엣 링으로 헤드 위치를 더 선명하게 강조
  if (headFocusPulse > 0.01) {
    ctx.strokeStyle = `rgba(10,16,28,${0.18 + headFocusPulse * 0.35})`;
    ctx.lineWidth = 10 + headFocusPulse * 7;
    ctx.beginPath();
    ctx.arc(x, y, s * (0.58 + headFocusPulse * 0.28), 0, Math.PI * 2);
    ctx.stroke();
  }

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
  const swingEnergy = Math.max(0, player.swing);
  ctx.strokeStyle = '#140d09';
  ctx.lineWidth = 15.5 + comboPulse * 2.2 + swingEnergy * 1.8;
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

  // 타격 리듬에 반응하는 림 라이트
  if (comboPulse > 0.01) {
    ctx.strokeStyle = `rgba(255, 224, 140, ${0.12 + comboPulse * 0.35})`;
    ctx.lineWidth = 4 + comboPulse * 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  const headX = x + Math.cos(ang) * len * 0.42;
  const headY = y + Math.sin(ang) * len * 0.42;

  // 헤드 실루엣 앵커: 언제나 보이는 저채도 백링(배경/블록 위 가독성 확보)
  const anchorR = s * (0.18 + headFocusPulse * 0.05 + impactStreak * 0.08);
  const anchorG = ctx.createRadialGradient(headX, headY, 2, headX, headY, anchorR * 2.4);
  anchorG.addColorStop(0, `rgba(8,12,20,${0.42 + impactStreak * 0.2})`);
  anchorG.addColorStop(1, 'rgba(8,12,20,0)');
  ctx.fillStyle = anchorG;
  ctx.beginPath();
  ctx.arc(headX, headY, anchorR * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // 헤드 글로우
  if (player.glow > 0 || hitPulse > 0 || impactStreak > 0.08) {
    const pulse = Math.max(player.glow, hitPulse * 0.8, impactStreak * 0.55);
    const r = 20 + pulse * 30;
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
  ctx.strokeStyle = '#0b111c';
  ctx.lineWidth = 5.4 + swingEnergy * 1.3;

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

  // 헤드 실루엣 외곽광: 블록 배경 위에서도 형태가 안 묻히도록 보정
  if (headFocusPulse > 0.01) {
    ctx.strokeStyle = `rgba(255,233,160,${0.20 + headFocusPulse * 0.55})`;
    ctx.lineWidth = 2.5 + headFocusPulse * 2.5;
    ctx.beginPath();
    ctx.moveTo(-s * 0.54, -s * 0.03);
    ctx.lineTo(-s * 0.45, -s * 0.20);
    ctx.lineTo(-s * 0.06, -s * 0.13);
    ctx.moveTo(s * 0.10, -s * 0.10);
    ctx.lineTo(s * 0.50, -s * 0.06);
    ctx.stroke();
  }

  ctx.restore();
}
function draw() {
  // 배경 (캐시된 그래디언트 사용)
  ctx.fillStyle = bgGradient;
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
  const springKick = collisionSpring * 0.9;
  const oy = (shake ? (Math.random() * 2 - 1) * shake : 0) + springKick;

  // 하강 속도선: 물리적 낙하 체감 강화
  const speedN = Math.max(0, Math.min(1, (camVel - 48) / 170 + freefallChain * 0.22));
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

    // 급강하 구간에서 중심부 수직 러시를 추가해 아래로 빨려드는 감각 강화
    if (dropSurge > 0.18) {
      const rushA = 0.03 + dropSurge * 0.10;
      const rushG = ctx.createLinearGradient(W * 0.5, 0, W * 0.5, H);
      rushG.addColorStop(0, `rgba(125,190,255,0)`);
      rushG.addColorStop(0.4, `rgba(125,190,255,${rushA})`);
      rushG.addColorStop(1, `rgba(125,190,255,0)`);
      ctx.fillStyle = rushG;
      ctx.fillRect(W * 0.2, 0, W * 0.6, H);
    }
  }

  // 고속 낙하 누적 스트레스: 화면 가장자리 압박 비네트
  if (fallStress > 0.04) {
    const stressG = ctx.createRadialGradient(W * 0.5, H * 0.52, H * 0.20, W * 0.5, H * 0.52, H * 0.9);
    stressG.addColorStop(0, `rgba(255,255,255,0)`);
    stressG.addColorStop(1, `rgba(125,170,255,${fallStress * 0.16})`);
    ctx.fillStyle = stressG;
    ctx.fillRect(0, 0, W, H);
  }

  // 착지 직전 긴장감(예측 충돌 펄스)
  if (preImpactPulse > 0.02) {
    const edgeA = preImpactPulse * (0.16 + Math.sin(t * 34) * 0.03);
    ctx.strokeStyle = `rgba(150, 210, 255, ${edgeA})`;
    ctx.lineWidth = 2 + preImpactPulse * 4;
    ctx.strokeRect(5, 5, W - 10, H - 10);
  }

  // 블록 렌더
  for (const b of blocks) {
    const y = b.y - camY + oy;
    if (y < -BLOCK || y > H + BLOCK) continue;

    let col = BLOCK_COLORS[b.type] || BLOCK_COLORS.normal;

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


  // 타격 슬래시 마커(한 프레임 감각의 절단선)
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const sm of slashMarks) {
    const lifeN = Math.max(0, sm.life / sm.maxLife);
    const len = 22 + sm.power * 16 + (1 - lifeN) * 14;
    const thickness = 2 + sm.power * 1.6;
    const col = sm.strong > 0.8 ? '255,105,105' : sm.strong > 0.4 ? '111,224,255' : '255,233,170';

    const sx = sm.x + ox - Math.cos(sm.ang) * len * 0.55;
    const sy = sm.y + oy - Math.sin(sm.ang) * len * 0.55;
    const ex = sm.x + ox + Math.cos(sm.ang) * len * 0.55;
    const ey = sm.y + oy + Math.sin(sm.ang) * len * 0.55;

    ctx.globalAlpha = 0.9 * lifeN;
    ctx.strokeStyle = `rgba(${col}, 0.95)`;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // 중심 크로스-컷으로 명중 지점 강조
    const crossAng = sm.ang + Math.PI * 0.5;
    const cLen = len * 0.35;
    ctx.globalAlpha = 0.55 * lifeN;
    ctx.lineWidth = Math.max(1.5, thickness * 0.55);
    ctx.beginPath();
    ctx.moveTo(sm.x + ox - Math.cos(crossAng) * cLen * 0.5, sm.y + oy - Math.sin(crossAng) * cLen * 0.5);
    ctx.lineTo(sm.x + ox + Math.cos(crossAng) * cLen * 0.5, sm.y + oy + Math.sin(crossAng) * cLen * 0.5);
    ctx.stroke();
  }
  ctx.restore();
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

    // 별형 코어 스파크: "맞았다"는 중심 타점을 더 강하게 고정
    ctx.globalAlpha = 0.44 * lifeN;
    ctx.fillStyle = `rgba(${hitColor}, 0.9)`;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI * 2 * i) / 8 + t * 5.5;
      const r = i % 2 === 0 ? 3 + ib.power * 2.8 : 1.3 + ib.power * 0.9;
      const px = ib.x + ox + Math.cos(ang) * r;
      const py = ib.y + oy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
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

  // 타격 직후 미세 플래시: 손맛 전달 강화(짧고 약하게)
  if (impactFlash > 0.01) {
    const flashN = Math.min(1, impactFlash);
    ctx.fillStyle = `rgba(255, 238, 186, ${flashN * 0.10})`;
    ctx.fillRect(0, 0, W, H);
  }

  // 연속 타격 누적 시 냉색 림 비네트(타격 리듬 가시화)
  if (impactStreak > 0.04) {
    const rg = ctx.createRadialGradient(W * 0.5, H * 0.48, H * 0.18, W * 0.5, H * 0.5, H * 0.9);
    rg.addColorStop(0, 'rgba(255,255,255,0)');
    rg.addColorStop(1, `rgba(120,210,255,${impactStreak * 0.16})`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }

  // 착지 충격 비네트
  if (landingPulse > 0) {
    const lg = ctx.createRadialGradient(W * 0.5, H * 0.7, 20, W * 0.5, H * 0.7, H * 0.9);
    lg.addColorStop(0, `rgba(255,220,150,${landingPulse * 0.12})`);
    lg.addColorStop(1, `rgba(0,0,0,${landingPulse * 0.22})`);
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);

    // 착지 충돌 링: 바닥에서 가로로 퍼지는 압력파를 추가해 충돌 체감 강화
    const pulseN = Math.min(1, landingPulse * 2.6);
    ctx.strokeStyle = `rgba(255, 214, 150, ${0.18 * pulseN})`;
    ctx.lineWidth = 2 + pulseN * 2.6;
    ctx.beginPath();
    ctx.ellipse(player.x + ox, H * 0.66 + oy, 34 + pulseN * 84, 8 + pulseN * 20, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(150, 205, 255, ${0.14 * pulseN})`;
    ctx.lineWidth = 1.5 + pulseN * 2;
    ctx.beginPath();
    ctx.ellipse(player.x + ox, H * 0.66 + oy, 18 + pulseN * 52, 5 + pulseN * 14, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 연타 성공 시 화면 가장자리 미세 펄스
  if (comboPulse > 0.02) {
    ctx.strokeStyle = `rgba(255, 214, 120, ${comboPulse * 0.45})`;
    ctx.lineWidth = 3 + comboPulse * 2;
    ctx.strokeRect(10, 10, W - 20, H - 20);
  }

  // 기본 비네트로 중심부 시각적 대비 강화 (캐시)
  ctx.fillStyle = baseVignette;
  ctx.fillRect(0, 0, W, H);

  // HUD (가독성 강화)
  ctx.fillStyle = 'rgba(8,10,16,.72)';
  ctx.fillRect(12, 12, W - 24, 92);
  ctx.fillStyle = '#eaf0ff';
  ctx.font = 'bold 20px system-ui';
  ctx.fillText(`SCORE ${score}`, 24, 38);

  const depth = Math.floor(camY / BLOCK);
  ctx.font = '14px system-ui';
  ctx.fillStyle = '#c5d1ef';
  ctx.fillText(`DEPTH ${depth}m`, 24, 60);
  ctx.fillStyle = '#9fb0d8';
  ctx.fillText('AUTO IDLE SHOWCASE', W - 182, 60);

  const fps = Math.round(1000 / Math.max(1, frameMsAvg));
  ctx.fillStyle = '#86f0c5';
  ctx.fillText(`PERF ${fps}fps · ${blocks.length} blk · ${particles.length} pt`, 24, 80);
}

let last = performance.now();
function loop(now) {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.033, rawDt);
  last = now;
  frameMsAvg = frameMsAvg * 0.92 + rawDt * 1000 * 0.08;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

reset();
requestAnimationFrame(loop);
