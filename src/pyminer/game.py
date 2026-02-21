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
        self.player_vy = 210.0

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
        self.last_command_at = 0.0
        self.last_queue_pop = 0.0
        self.last_skill = 0.0
        self.active_skill_name = "-"

        self.shake_power = 0.0
        self.start_at = time.time()

    def generate_rows(self, start_row: int, row_count: int):
        cols = self.w // self.block_size
        for row in range(start_row, start_row + row_count):
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

    def handle_collisions(self):
        world_py = self.player_y + self.camera_y
        pr = self.player_radius * self.size_mul
        kept: list[Block] = []

        for b in self.blocks:
            rect = pygame.Rect(b.x, b.y, self.block_size, self.block_size)
            if self.circle_rect_hit(self.player_x, world_py, pr, rect):
                if b.kind == "hazard":
                    if self.shield:
                        self.effects["shield"] = 0
                        self.spawn_particles(rect.centerx, rect.centery, 12, (100, 220, 255))
                    else:
                        self.hp -= 1
                        self.shake_power = max(self.shake_power, 6)
                        self.spawn_particles(rect.centerx, rect.centery, 14, (255, 90, 90))
                        if self.hp <= 0:
                            self.game_over = True
                    continue

                b.hp -= 1
                gain = 4 if b.kind == "normal" else 8
                if b.kind == "ore":
                    gain = 20
                self.score += gain
                self.spawn_particles(rect.centerx, rect.centery, 5, (180, 180, 200))

                if b.hp <= 0:
                    continue
            kept.append(b)

        self.blocks = kept

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
        self.player_vy += self.cfg["GRAVITY"] * dt * 0.045
        self.camera_y += self.player_vy * dt * self.speed_mul
        self.depth = max(0, int(self.camera_y / self.block_size))

        target_last = int((self.camera_y + self.h * 2) / self.block_size)
        if target_last > self.last_generated_row:
            self.generate_rows(self.last_generated_row + 1, target_last - self.last_generated_row)

    def draw_background(self):
        for y in range(self.h):
            t = y / self.h
            c = (int(10 + 25 * t), int(14 + 30 * t), int(28 + 45 * t))
            pygame.draw.line(self.screen, c, (0, y), (self.w, y))

        for i, (sx, sy, s) in enumerate(self.stars):
            sy2 = (sy - int(self.camera_y * (0.03 + s * 0.01))) % self.h
            pygame.draw.circle(self.screen, (90 + s * 30, 100 + s * 20, 140 + s * 20), (sx, sy2), s)

    def draw(self):
        self.draw_background()

        ox = int(random.uniform(-self.shake_power, self.shake_power)) if self.shake_power > 0 else 0
        oy = int(random.uniform(-self.shake_power, self.shake_power)) if self.shake_power > 0 else 0
        self.shake_power *= 0.85

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

        # pickaxe-like player
        px, py = self.player_x + ox, int(self.player_y) + oy
        pr = int(self.player_radius * self.size_mul)
        pygame.draw.circle(self.screen, (220, 190, 90), (px, py), pr)
        pygame.draw.line(self.screen, (145, 103, 63), (px - 4, py + pr), (px + 4, py + pr + 20), 6)
        pygame.draw.polygon(self.screen, (190, 210, 230), [(px - pr, py), (px + pr, py), (px, py - pr - 8)])

        if self.shield:
            pygame.draw.circle(self.screen, (110, 230, 255), (px, py), pr + 7, 2)

        for p in self.particles:
            alpha = max(30, int(255 * p.life * 2))
            col = tuple(min(255, int(c * alpha / 255)) for c in p.color)
            pygame.draw.circle(self.screen, col, (int(p.x) + ox, int(p.y - self.camera_y) + oy), 2)

        remain = max(0, int(self.round_seconds - (time.time() - self.start_at)))
        panel = pygame.Surface((self.w - 20, 104), pygame.SRCALPHA)
        panel.fill((10, 10, 14, 150))
        self.screen.blit(panel, (10, 10))

        lines = [
            f"SCORE {self.score}",
            f"DEPTH {self.depth}m   HP {'♥' * max(0, self.hp)}",
            f"QUEUE {', '.join(self.command_queue[:3]) or '-'}",
            f"SKILL {self.active_skill_name}",
        ]
        y = 18
        for ln in lines:
            self.screen.blit(self.font.render(ln, True, (238, 238, 240)), (20, y))
            y += 22

        # timer bar
        ratio = remain / self.round_seconds if self.round_seconds else 0
        pygame.draw.rect(self.screen, (55, 60, 75), (20, self.h - 28, self.w - 40, 10), border_radius=5)
        pygame.draw.rect(self.screen, (80, 220, 140), (20, self.h - 28, int((self.w - 40) * ratio), 10), border_radius=5)
        self.screen.blit(self.font_small.render("A/D move · 1~5 commands", True, (220, 220, 230)), (20, self.h - 52))

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
            vx = self.cfg["PLAYER_BASE_SPEED"] * self.speed_mul
            if keys[pygame.K_a] or keys[pygame.K_LEFT]:
                self.player_x -= vx * dt
            if keys[pygame.K_d] or keys[pygame.K_RIGHT]:
                self.player_x += vx * dt
            self.player_x = max(20, min(self.w - 20, self.player_x))

            if self.cfg.get("AUTO_MODE", True) and random.random() < 0.018:
                self.enqueue_command(random.choice(["tnt", "boost", "slow", "big", "shield"]))

            if not self.game_over and (time.time() - self.start_at) < self.round_seconds:
                self.pop_command()
                self.apply_sponsor_skill()
                self.update_effects()
                self.update_world(dt)
                self.handle_collisions()
                self.update_particles(dt)

            self.draw()

        pygame.quit()
