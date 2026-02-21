from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_PATH = ROOT / "default.config.json"
CONFIG_PATH = ROOT / "config.json"


def load_config() -> dict:
    with DEFAULT_CONFIG_PATH.open("r", encoding="utf-8") as f:
        default_cfg = json.load(f)

    if not CONFIG_PATH.exists():
        with CONFIG_PATH.open("w", encoding="utf-8") as f:
            json.dump(default_cfg, f, ensure_ascii=False, indent=2)
        return default_cfg

    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        user_cfg = json.load(f)

    merged = dict(default_cfg)
    merged.update(user_cfg)
    return merged
