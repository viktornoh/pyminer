from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass

import pygame


@dataclass
class Block:
    x: int
    y: int
    hp: int
    kind: str


@dataclass
class Particle:
    x: float
    y: float
    vx: float
    vy: float
    life: float
    color: tuple[int, int, int]


class Game:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.w = cfg["WINDOW_WIDTH"]
        self.h = cfg["WINDOW_HEIGHT"]
        self.fps = cfg["FPS"]
        self.block_size = cfg["BLOCK_SIZE"]
        self.round_seconds = cfg["ROUND_SECONDS"]

        pygame.init()
        self.screen = pygame.display.set_mode((self.w, self.h))
        pygame.display.set_caption("pyminer")
        self.clock = pygame.time.Clock()
        self.font = pygame.font.SysFont("Arial", 20, bold=True)
        self.font_small = pygame.font.SysFont("Arial", 16)

        self.player_x = self.w // 2
        self.player_y = int(self.h * 0.42)
        self.player_radius = cfg["PLAYER_RADIUS"]
        self.pickaxe_scale = cfg.get("PICKAXE_SCALE", 1.6)
        self.top_clear_rows = cfg.get("TOP_CLEAR_ROWS", 2)
        self.auto_fall_mul = cfg.get("AUTO_FALL_MUL", 0.55)
        self.gravity_mul = cfg.get("GRAVITY_MUL", 0.022)
        self.player_vx = 0.0
        self.player_vy = cfg.get("PLAYER_START_FALL_SPEED", 130.0)
        self.move_dir = 0

        self.camera_y = 0.0
        self.score = 0
        self.depth = 0
        self.hp = 5
        self.game_over = False

        self.speed_mul = 1.0
        self.size_mul = 1.0
        self.shield = False
        self.effects: dict[str, float] = {}

        self.blocks: list[Block] = []
        self.particles: list[Particle] = []
        self.stars = [(random.randint(0, self.w), random.randint(0, self.h), random.randint(1, 3)) for _ in range(70)]

        self.last_generated_row = -1
        self.generate_rows(0, cfg["SPAWN_ROWS_AHEAD"])

        self.command_queue: list[str] = []
        self.recent_commands: list[str] = []
        self.last_command_at = 0.0
        self.last_queue_pop = 0.0
        self.last_skill = 0.0
        self.active_skill_name = "-"
        self.sponsor_card_until = 0.0

        self.shake_power = 0.0
        self.hit_flash = 0.0
        self.hit_stop_until = 0.0
        self.player_invuln_until = 0.0
        self.block_hit_at: dict[tuple[int, int], float] = {}

        self.block_contact_cooldown = cfg.get("BLOCK_CONTACT_COOLDOWN_SECONDS", 0.085)
        self.hazard_invuln_seconds = cfg.get("HAZARD_INVULN_SECONDS", 0.85)
        self.impact_hitstop_max = cfg.get("IMPACT_HITSTOP_MAX_SECONDS", 0.05)
        self.restitution_normal = cfg.get("RESTITUTION_NORMAL", 0.18)
        self.restitution_hazard = cfg.get("RESTITUTION_HAZARD", 0.05)
        self.air_control = cfg.get("AIR_CONTROL", 9.5)
        self.max_fall_speed = cfg.get("MAX_FALL_SPEED", 780)
        self.wall_friction = cfg.get("WALL_FRICTION", 0.82)

        self.start_at = time.time()

    def get_pickaxe_radius(self) -> float:
        return max(self.player_radius, self.block_size * 0.45 * self.pickaxe_scale) * self.size_mul

    def generate_rows(self, start_row: int, row_count: int):
        cols = self.w // self.block_size
        for row in range(start_row, start_row + row_count):
            if row < self.top_clear_rows:
                self.last_generated_row = row
                continue
            for col in range(cols):
                roll = random.random()
                if roll < 0.20:
                    continue
                kind = "normal"
                hp = self.cfg["BLOCK_HP"]
                if roll > 0.93:
                    kind = "hazard"
                    hp = 2
                elif roll > 0.82:
                    kind = "ore"
                    hp = self.cfg["BLOCK_HP"]
                elif roll > 0.70:
                    kind = "hard"
                    hp = self.cfg["BLOCK_HP"] + 1
                self.blocks.append(Block(col * self.block_size, row * self.block_size, hp, kind))
            self.last_generated_row = row

    def enqueue_command(self, cmd: str):
        now = time.time()
        if now - self.last_command_at < self.cfg["COMMAND_COOLDOWN_SECONDS"]:
            return
        self.command_queue.append(cmd)
        self.last_command_at = now

    def pop_command(self):
        now = time.time()
        if now - self.last_queue_pop < self.cfg["QUEUE_POP_INTERVAL_SECONDS"] or not self.command_queue:
            return

        cmd = self.command_queue.pop(0)
        self.recent_commands = ([cmd] + self.recent_commands)[:4]
        self.last_queue_pop = now
        if cmd == "tnt":
            self.trigger_tnt()
        elif cmd == "boost":
            self.effects["boost"] = now + self.cfg["BOOST_DURATION_SECONDS"]
        elif cmd == "slow":
            self.effects["slow"] = now + self.cfg["SLOW_DURATION_SECONDS"]
        elif cmd == "big":
            self.effects["big"] = now + self.cfg["BIG_DURATION_SECONDS"]
        elif cmd == "shield":
            self.effects["shield"] = now + self.cfg["SHIELD_DURATION_SECONDS"]

    def trigger_tnt(self):
        cx, cy = self.player_x, self.player_y + self.camera_y
        radius = self.cfg["TNT_RADIUS"]
        kept = []
        removed = 0
        for b in self.blocks:
            bx = b.x + self.block_size / 2
            by = b.y + self.block_size / 2
            if math.hypot(bx - cx, by - cy) <= radius:
                removed += 1
                self.spawn_particles(bx, by, 6, (255, 170, 80))
            else:
                kept.append(b)
        self.blocks = kept
        self.score += removed * 12
        self.shake_power = max(self.shake_power, 10)

    def apply_sponsor_skill(self):
        now = time.time()
        if now - self.last_skill < self.cfg["SPONSOR_SKILL_INTERVAL_SECONDS"]:
            return

        skills = [
            ("Cloud AutoScale", "boost"),
            ("Security ShieldWall", "shield"),
            ("AI SmartPath", "big"),
        ]
        name, effect = random.choice(skills)
        self.active_skill_name = name
        self.effects[effect] = now + 5
        self.last_skill = now
        self.sponsor_card_until = now + 1.6

    def update_effects(self):
        now = time.time()
        self.speed_mul = 1.0
        self.size_mul = 1.0
        self.shield = False
        if self.effects.get("boost", 0) > now:
            self.speed_mul *= 1.45
        if self.effects.get("slow", 0) > now:
            self.speed_mul *= 0.68
        if self.effects.get("big", 0) > now:
            self.size_mul = 1.7
        if self.effects.get("shield", 0) > now:
            self.shield = True

    def spawn_particles(self, x: float, y: float, count: int, color: tuple[int, int, int]):
        for _ in range(count):
            ang = random.uniform(0, math.tau)
            spd = random.uniform(40, 200)
            self.particles.append(Particle(x, y, math.cos(ang) * spd, math.sin(ang) * spd, random.uniform(0.2, 0.5), color))

    def circle_rect_hit(self, cx: float, cy: float, r: float, rect: pygame.Rect) -> bool:
        nx = max(rect.left, min(cx, rect.right))
        ny = max(rect.top, min(cy, rect.bottom))
        return (cx - nx) ** 2 + (cy - ny) ** 2 <= r ** 2

    def resolve_circle_rect(self, cx: float, cy: float, r: float, rect: pygame.Rect) -> tuple[float, float, float, float] | None:
        nearest_x = max(rect.left, min(cx, rect.right))
        nearest_y = max(rect.top, min(cy, rect.bottom))
        dx = cx - nearest_x
        dy = cy - nearest_y
        dist_sq = dx * dx + dy * dy

        if dist_sq > r * r:
            return None

        if dist_sq > 1e-6:
            dist = math.sqrt(dist_sq)
            nx = dx / dist
            ny = dy / dist
            penetration = r - dist
            return nx, ny, penetration, max(0.0, -self.player_vx * nx - self.player_vy * ny)

        left_pen = cx - rect.left
        right_pen = rect.right - cx
        top_pen = cy - rect.top
        bot_pen = rect.bottom - cy
        pen = min(left_pen, right_pen, top_pen, bot_pen)
        if pen == left_pen:
            return -1.0, 0.0, r + pen, max(0.0, self.player_vx)
        if pen == right_pen:
            return 1.0, 0.0, r + pen, max(0.0, -self.player_vx)
        if pen == top_pen:
            return 0.0, -1.0, r + pen, max(0.0, self.player_vy)
        return 0.0, 1.0, r + pen, max(0.0, -self.player_vy)

    def handle_collisions(self):
        world_py = self.player_y + self.camera_y
        pr = self.get_pickaxe_radius()
        now = time.time()
        kept: list[Block] = []

        for b in self.blocks:
            rect = pygame.Rect(b.x, b.y, self.block_size, self.block_size)
            hit = self.resolve_circle_rect(self.player_x, world_py, pr, rect)
            if not hit:
                kept.append(b)
                continue

            nx, ny, penetration, impact = hit
            self.player_x += nx * penetration
            world_py += ny * penetration
            self.player_x = max(pr, min(self.w - pr, self.player_x))

            vn = self.player_vx * nx + self.player_vy * ny
            if vn < 0:
                restitution = self.restitution_normal if b.kind != "hazard" else self.restitution_hazard
                self.player_vx -= (1.0 + restitution) * vn * nx
                self.player_vy -= (1.0 + restitution) * vn * ny

                tangent_x, tangent_y = -ny, nx
                vt = self.player_vx * tangent_x + self.player_vy * tangent_y
                self.player_vx -= vt * (1.0 - self.wall_friction) * tangent_x
                self.player_vy -= vt * (1.0 - self.wall_friction) * tangent_y

            block_key = (b.x, b.y)
            recent_hit = now - self.block_hit_at.get(block_key, -99)

            if b.kind == "hazard":
                if self.shield:
                    self.effects["shield"] = 0
                    self.spawn_particles(rect.centerx, rect.centery, 12, (100, 220, 255))
                    self.shake_power = max(self.shake_power, 8)
                    self.hit_flash = max(self.hit_flash, 0.12)
                    continue

                if now >= self.player_invuln_until:
                    self.hp -= 1
                    self.player_invuln_until = now + self.hazard_invuln_seconds
                    self.player_vx += nx * 180
                    self.player_vy += ny * 220
                    self.shake_power = max(self.shake_power, 10)
                    self.hit_flash = max(self.hit_flash, 0.2)
                    self.spawn_particles(rect.centerx, rect.centery, 16, (255, 90, 90))
                    if self.hp <= 0:
                        self.game_over = True
                kept.append(b)
                continue

            if recent_hit > self.block_contact_cooldown:
                bonus = 0
                if impact > 170:
                    bonus += 1
                if impact > 280:
                    bonus += 1
                damage = 1 + bonus
                b.hp -= damage
                gain = 4 if b.kind == "normal" else 8
                if b.kind == "ore":
                    gain = 20
                self.score += gain + bonus * 2
                self.block_hit_at[block_key] = now
                self.spawn_particles(rect.centerx, rect.centery, 6 + bonus * 3, (180, 180, 200))
                self.shake_power = max(self.shake_power, min(9, 2 + impact * 0.015))
                self.hit_flash = max(self.hit_flash, min(0.14, 0.04 + impact * 0.00018))
                self.hit_stop_until = max(self.hit_stop_until, now + min(self.impact_hitstop_max, 0.01 + impact * 0.00003))

            if b.hp > 0:
                kept.append(b)
            else:
                self.spawn_particles(rect.centerx, rect.centery, 12, (245, 235, 190))
                self.player_vy *= 0.96
                self.shake_power = max(self.shake_power, 6)
                self.hit_flash = max(self.hit_flash, 0.12)

        self.camera_y = world_py - self.player_y
        self.blocks = kept
        if len(self.block_hit_at) > 2500:
            cutoff = now - 1.2
            self.block_hit_at = {k: t for k, t in self.block_hit_at.items() if t > cutoff}

    def update_particles(self, dt: float):
        kept = []
        for p in self.particles:
            p.life -= dt
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.vy += 420 * dt
            if p.life > 0:
                kept.append(p)
        self.particles = kept

    def update_world(self, dt: float):
        target_vx = self.move_dir * self.cfg["PLAYER_BASE_SPEED"] * self.speed_mul
        blend = min(1.0, self.air_control * dt)
        self.player_vx += (target_vx - self.player_vx) * blend

        self.player_vy += self.cfg["GRAVITY"] * dt * self.gravity_mul
        self.player_vy = min(self.max_fall_speed * 0.72, self.player_vy)

        self.player_x += self.player_vx * dt
        pr = self.get_pickaxe_radius()
        self.player_x = max(pr, min(self.w - pr, self.player_x))

        self.camera_y += self.player_vy * dt * self.speed_mul * self.auto_fall_mul
        self.depth = max(0, int(self.camera_y / self.block_size))

        target_last = int((self.camera_y + self.h * 2) / self.block_size)
        if target_last > self.last_generated_row:
            self.generate_rows(self.last_generated_row + 1, target_last - self.last_generated_row)

    def draw_background(self):
        for y in range(self.h):
            t = y / self.h
            c = (int(10 + 25 * t), int(14 + 30 * t), int(28 + 45 * t))
            pygame.draw.line(self.screen, c, (0, y), (self.w, y))

        for sx, sy, s in self.stars:
            sy2 = (sy - int(self.camera_y * (0.03 + s * 0.01))) % self.h
            pygame.draw.circle(self.screen, (90 + s * 30, 100 + s * 20, 140 + s * 20), (sx, sy2), s)

    def draw(self):
        self.draw_background()

        ox = int(random.uniform(-self.shake_power, self.shake_power)) if self.shake_power > 0 else 0
        oy = int(random.uniform(-self.shake_power, self.shake_power)) if self.shake_power > 0 else 0
        self.shake_power *= 0.85
        self.hit_flash = max(0.0, self.hit_flash * 0.85)

        for b in self.blocks:
            sy = int(b.y - self.camera_y) + oy
            if sy < -self.block_size or sy > self.h + self.block_size:
                continue
            x = b.x + ox
            color = (90, 97, 114)
            if b.kind == "hard":
                color = (125, 92, 70)
            elif b.kind == "ore":
                color = (58, 175, 230)
            elif b.kind == "hazard":
                color = (175, 52, 52)
            pygame.draw.rect(self.screen, color, (x, sy, self.block_size - 2, self.block_size - 2), border_radius=6)

        px, py = self.player_x + ox, int(self.player_y) + oy
        pr = int(self.get_pickaxe_radius())
        metal_color = (195, 215, 236) if time.time() >= self.player_invuln_until or int(time.time() * 20) % 2 == 0 else (255, 140, 140)
        handle_color = (138, 98, 58)
        lean = max(-10, min(10, int(self.player_vx * 0.04)))

        handle_start = (px - pr // 2 + lean, py + pr // 2)
        handle_end = (px + pr // 2 + lean, py - pr // 2)
        pygame.draw.line(self.screen, handle_color, handle_start, handle_end, max(8, pr // 3))

        head_center = (px + pr // 2 + lean, py - pr // 2)
        blade = [
            (head_center[0] - pr // 5, head_center[1] - pr // 3),
            (head_center[0] + pr, head_center[1] - pr // 6),
            (head_center[0] + pr + pr // 5, head_center[1] + pr // 6),
            (head_center[0], head_center[1] + pr // 2),
        ]
        pick = [
            (head_center[0] - pr // 3, head_center[1] - pr // 5),
            (head_center[0] - pr - pr // 5, head_center[1] - pr // 2),
            (head_center[0] - pr // 2, head_center[1] + pr // 3),
        ]
        pygame.draw.polygon(self.screen, metal_color, blade)
        pygame.draw.polygon(self.screen, metal_color, pick)
        pygame.draw.circle(self.screen, (160, 170, 185), head_center, max(4, pr // 7))

        if self.shield:
            pygame.draw.circle(self.screen, (110, 230, 255), (px, py), pr + 10, 2)

        for p in self.particles:
            alpha = max(30, int(255 * p.life * 2))
            col = tuple(min(255, int(c * alpha / 255)) for c in p.color)
            pygame.draw.circle(self.screen, col, (int(p.x) + ox, int(p.y - self.camera_y) + oy), 2)

        if self.hit_flash > 0:
            flash = pygame.Surface((self.w, self.h), pygame.SRCALPHA)
            flash.fill((255, 245, 230, int(130 * self.hit_flash)))
            self.screen.blit(flash, (0, 0))

        remain = max(0, int(self.round_seconds - (time.time() - self.start_at)))
        panel = pygame.Surface((self.w - 20, 104), pygame.SRCALPHA)
        panel.fill((10, 10, 14, 150))
        self.screen.blit(panel, (10, 10))

        lines = [
            f"SCORE {self.score}",
            f"TIME {remain:03d}s   DEPTH {self.depth}m   HP {'♥' * max(0, self.hp)}",
            f"CHAT {', '.join(self.recent_commands) or '-'}",
            f"SKILL {self.active_skill_name}",
        ]
        y = 18
        for ln in lines:
            self.screen.blit(self.font.render(ln, True, (238, 238, 240)), (20, y))
            y += 22

        ratio = remain / self.round_seconds if self.round_seconds else 0
        pygame.draw.rect(self.screen, (55, 60, 75), (20, self.h - 28, self.w - 40, 10), border_radius=5)
        pygame.draw.rect(self.screen, (80, 220, 140), (20, self.h - 28, int((self.w - 40) * ratio), 10), border_radius=5)
        self.screen.blit(self.font_small.render("A/D move · 1~5 commands", True, (220, 220, 230)), (20, self.h - 52))

        if time.time() < self.sponsor_card_until:
            card_w, card_h = self.w - 120, 72
            card_x = (self.w - card_w) // 2
            card_y = 130
            card = pygame.Surface((card_w, card_h), pygame.SRCALPHA)
            card.fill((28, 34, 56, 220))
            self.screen.blit(card, (card_x, card_y))
            title = self.font_small.render("SPONSOR SKILL ACTIVATED", True, (145, 205, 255))
            name = self.font.render(self.active_skill_name, True, (255, 255, 255))
            self.screen.blit(title, (card_x + 16, card_y + 10))
            self.screen.blit(name, (card_x + 16, card_y + 30))

        if self.game_over or remain <= 0:
            txt = "GAME OVER" if self.game_over else "ROUND END"
            msg = self.font.render(f"{txt}  |  R restart  ESC quit", True, (255, 120, 120))
            self.screen.blit(msg, (self.w // 2 - msg.get_width() // 2, self.h // 2))

        pygame.display.flip()

    def reset(self):
        self.__init__(self.cfg)

    def run(self):
        running = True
        while running:
            dt = self.clock.tick(self.fps) / 1000.0
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                elif event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_ESCAPE:
                        running = False
                    if event.key == pygame.K_r and (self.game_over or (time.time() - self.start_at) >= self.round_seconds):
                        self.reset()
                    if event.key == pygame.K_1:
                        self.enqueue_command("tnt")
                    if event.key == pygame.K_2:
                        self.enqueue_command("boost")
                    if event.key == pygame.K_3:
                        self.enqueue_command("slow")
                    if event.key == pygame.K_4:
                        self.enqueue_command("big")
                    if event.key == pygame.K_5:
                        self.enqueue_command("shield")

            keys = pygame.key.get_pressed()
            self.move_dir = 0
            if keys[pygame.K_a] or keys[pygame.K_LEFT]:
                self.move_dir -= 1
            if keys[pygame.K_d] or keys[pygame.K_RIGHT]:
                self.move_dir += 1

            if self.cfg.get("AUTO_MODE", True) and random.random() < 0.018:
                self.enqueue_command(random.choice(["tnt", "boost", "slow", "big", "shield"]))

            now = time.time()
            if not self.game_over and (now - self.start_at) < self.round_seconds:
                self.pop_command()
                self.apply_sponsor_skill()
                self.update_effects()

                if now >= self.hit_stop_until:
                    self.update_world(dt)
                self.handle_collisions()
                self.update_particles(dt)

            self.draw()

        pygame.quit()
