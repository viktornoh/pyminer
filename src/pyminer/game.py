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
        pygame.display.set_caption("pyminer MVP")
        self.clock = pygame.time.Clock()
        self.font = pygame.font.SysFont("Arial", 20)

        self.player_x = self.w // 2
        self.player_y = self.h // 3
        self.player_vy = 0.0
        self.player_radius = cfg["PLAYER_RADIUS"]
        self.camera_y = 0.0

        self.score = 0
        self.depth = 0
        self.hp = 5
        self.shield = False
        self.game_over = False

        self.speed_mul = 1.0
        self.size_mul = 1.0
        self.effects: dict[str, float] = {}

        self.blocks: list[Block] = []
        self.last_generated_row = -1
        self.generate_rows(0, cfg["SPAWN_ROWS_AHEAD"])

        self.command_queue: list[str] = []
        self.last_command_at = 0.0
        self.last_queue_pop = 0.0
        self.last_skill = 0.0
        self.active_skill_name = "-"

        self.start_at = time.time()

    def generate_rows(self, start_row: int, row_count: int):
        kinds = ["normal", "hard", "ore"]
        for row in range(start_row, start_row + row_count):
            for col in range(self.w // self.block_size):
                if random.random() < 0.12:
                    continue
                kind = random.choices(kinds, weights=[0.7, 0.2, 0.1], k=1)[0]
                hp = self.cfg["BLOCK_HP"] + (1 if kind == "hard" else 0)
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
        if now - self.last_queue_pop < self.cfg["QUEUE_POP_INTERVAL_SECONDS"]:
            return
        if not self.command_queue:
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
        removed = 0
        keep = []
        for b in self.blocks:
            bx = b.x + self.block_size / 2
            by = b.y + self.block_size / 2
            if math.hypot(bx - cx, by - cy) <= radius:
                removed += 1
                self.score += 8
            else:
                keep.append(b)
        self.blocks = keep
        self.score += removed * 2

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
            self.speed_mul *= 1.5
        if self.effects.get("slow", 0) > now:
            self.speed_mul *= 0.65
        if self.effects.get("big", 0) > now:
            self.size_mul = 1.8
        if self.effects.get("shield", 0) > now:
            self.shield = True

    def handle_collisions(self):
        r = self.player_radius * self.size_mul
        py = self.player_y + self.camera_y
        keep = []
        for b in self.blocks:
            rect = pygame.Rect(b.x, b.y, self.block_size, self.block_size)
            if rect.collidepoint(self.player_x, py):
                b.hp -= 1
                self.score += 3
                if b.hp <= 0:
                    self.score += 10 if b.kind == "ore" else 5
                    continue
            keep.append(b)
        self.blocks = keep

        if random.random() < 0.0018:
            if self.shield:
                self.shield = False
                self.effects["shield"] = 0
            else:
                self.hp -= 1
                if self.hp <= 0:
                    self.game_over = True

    def update_world(self, dt: float):
        self.player_vy += self.cfg["GRAVITY"] * dt * 0.5
        self.camera_y += self.player_vy * dt
        self.depth = int(self.camera_y / self.block_size)
        if self.depth < 0:
            self.depth = 0

        target_last = int((self.camera_y + self.h * 2) / self.block_size)
        if target_last > self.last_generated_row:
            self.generate_rows(self.last_generated_row + 1, target_last - self.last_generated_row)

    def draw(self):
        self.screen.fill((14, 16, 28))

        for b in self.blocks:
            sy = int(b.y - self.camera_y)
            if sy < -self.block_size or sy > self.h + self.block_size:
                continue
            color = (80, 80, 80)
            if b.kind == "hard":
                color = (110, 80, 70)
            elif b.kind == "ore":
                color = (40, 130, 190)
            pygame.draw.rect(self.screen, color, (b.x, sy, self.block_size - 2, self.block_size - 2))

        py = int(self.player_y)
        pr = int(self.player_radius * self.size_mul)
        pygame.draw.circle(self.screen, (240, 200, 70), (self.player_x, py), pr)
        if self.shield:
            pygame.draw.circle(self.screen, (120, 220, 255), (self.player_x, py), pr + 5, 2)

        remain = max(0, int(self.round_seconds - (time.time() - self.start_at)))
        hud = [
            f"Score: {self.score}",
            f"Depth: {self.depth}",
            f"HP: {self.hp}",
            f"Time: {remain}s",
            f"Queue: {', '.join(self.command_queue[:3]) or '-'}",
            f"Sponsor Skill: {self.active_skill_name}",
            "Keys: A/D move, 1~5 commands(tnt/boost/slow/big/shield)",
        ]
        y = 10
        for line in hud:
            surf = self.font.render(line, True, (230, 230, 230))
            self.screen.blit(surf, (10, y))
            y += 24

        if self.game_over or remain <= 0:
            text = self.font.render("ROUND END - Press R to restart / ESC to quit", True, (255, 90, 90))
            self.screen.blit(text, (20, self.h // 2))

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
                if event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_ESCAPE:
                        running = False
                    if event.key == pygame.K_r and self.game_over:
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

            if self.cfg.get("AUTO_MODE", True) and random.random() < 0.015:
                self.enqueue_command(random.choice(["tnt", "boost", "slow", "big", "shield"]))

            if not self.game_over and (time.time() - self.start_at) < self.round_seconds:
                self.pop_command()
                self.apply_sponsor_skill()
                self.update_effects()
                self.update_world(dt)
                self.handle_collisions()

            self.draw()

        pygame.quit()
