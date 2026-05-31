#!/usr/bin/env python3
"""Sync ~/.claude/agents/*.md → motion.db agents table.

Idempotent: INSERT OR REPLACE keyed on agent id (filename slug).
Preserves user-modifiable fields (status, learnings_md, last_active, schedule_id,
avatar_color when already set) and only refreshes fields that come from the .md
file (name, role, system_prompt, model_preference, allowed_tools).

Runs every 5 min via com.hiilite.agents-sync LaunchAgent. Also safe to invoke
manually:  python3 ~/code/motion-lite/scripts/agents-sync.py

Logs nothing on no-op runs to keep the log file clean.
"""

import hashlib
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

AGENTS_DIR = Path.home() / ".claude/agents"
DB_PATH = Path.home() / "code/store/motion.db"
STATE_FILE = Path.home() / "code/store/.agents-sync.state"

# Pastel palette indexed by hash → deterministic avatar colors
PALETTE = [
    "#7DD3FC", "#FCA5A5", "#86EFAC", "#FCD34D", "#C4B5FD",
    "#F9A8D4", "#FDBA74", "#A5F3FC", "#FECACA", "#BBF7D0",
    "#FDE68A", "#DDD6FE", "#FBCFE8", "#FED7AA", "#A7F3D0",
]


def parse_frontmatter(text):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    fm_block = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")

    fm = {}
    current_key = None
    current_value_lines = []
    for raw in fm_block.splitlines():
        m = re.match(r"^([\w-]+):\s*(.*)$", raw)
        if m:
            if current_key is not None:
                fm[current_key] = "\n".join(current_value_lines).strip()
            current_key = m.group(1)
            current_value_lines = [m.group(2)] if m.group(2) else []
        else:
            current_value_lines.append(raw)
    if current_key is not None:
        fm[current_key] = "\n".join(current_value_lines).strip()

    for k, v in list(fm.items()):
        v2 = v.strip()
        if v2.startswith(">"):
            v2 = v2[1:].strip()
        fm[k] = v2.replace("\n", " ").strip()

    return fm, body


def parse_tools(tools_str):
    if not tools_str:
        return ["*"]
    return [t.strip() for t in tools_str.split(",") if t.strip()]


def avatar_color(name):
    h = int(hashlib.md5(name.encode()).hexdigest(), 16)
    return PALETTE[h % len(PALETTE)]


def title_case(slug):
    return " ".join(w.capitalize() for w in slug.split("-"))


def fingerprint_files():
    """Hash of (filename, mtime, size) for all *.md so we can detect changes cheaply."""
    parts = []
    for p in sorted(AGENTS_DIR.glob("*.md")):
        if p.name.lower() == "readme.md":
            continue
        st = p.stat()
        parts.append(f"{p.name}:{int(st.st_mtime)}:{st.st_size}")
    return hashlib.sha1("|".join(parts).encode()).hexdigest()


def main():
    if not AGENTS_DIR.is_dir():
        print(f"agents dir not found: {AGENTS_DIR}", file=sys.stderr)
        return 1

    # Skip work if nothing changed since last run
    fp = fingerprint_files()
    last_fp = STATE_FILE.read_text().strip() if STATE_FILE.exists() else ""
    if fp == last_fp:
        return 0  # no-op, silent

    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    existing = {r["id"]: dict(r) for r in cur.execute("SELECT * FROM agents")}

    files = sorted([p for p in AGENTS_DIR.glob("*.md") if p.name.lower() != "readme.md"])

    added = 0
    refreshed = 0
    for path in files:
        slug = path.stem
        fm, body = parse_frontmatter(path.read_text())
        name = title_case(slug)
        description = fm.get("description", "")
        model_pref = fm.get("model", "auto")
        tools = parse_tools(fm.get("tools", ""))
        role = (description.split(".")[0] if description else "")[:80].strip()

        prev = existing.get(slug, {})
        status = prev.get("status") or "standby"
        last_active = prev.get("last_active")
        learnings_md = prev.get("learnings_md")
        memory_md = prev.get("memory_md")
        avatar_url = prev.get("avatar_url")
        avatar_color_v = prev.get("avatar_color") or avatar_color(slug)
        max_daily_minutes = prev.get("max_daily_minutes") or 480
        max_turns = prev.get("max_turns") or 50

        # Only count as "refreshed" if the source content actually changed
        new_prompt = body.strip()
        new_tools_json = json.dumps(tools)
        if slug in existing:
            if (
                existing[slug].get("system_prompt") == new_prompt
                and existing[slug].get("model_preference") == model_pref
                and existing[slug].get("allowed_tools") == new_tools_json
                and existing[slug].get("name") == name
                and existing[slug].get("role") == role
            ):
                continue  # no change for this agent

        cur.execute(
            """
            INSERT INTO agents (
                id, name, role, system_prompt, soul_md, memory_md,
                avatar_color, status, last_active, model_preference,
                allowed_tools, max_turns, learnings_md, avatar_url,
                max_daily_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                role = excluded.role,
                system_prompt = excluded.system_prompt,
                model_preference = excluded.model_preference,
                allowed_tools = excluded.allowed_tools,
                avatar_color = COALESCE(agents.avatar_color, excluded.avatar_color)
            """,
            (
                slug, name, role, new_prompt, None, memory_md,
                avatar_color_v, status, last_active, model_pref,
                new_tools_json, max_turns, learnings_md, avatar_url,
                max_daily_minutes,
            ),
        )
        if slug in existing:
            refreshed += 1
        else:
            added += 1

    con.commit()
    con.close()

    STATE_FILE.write_text(fp)

    if added or refreshed:
        print(f"agents-sync: added={added}, refreshed={refreshed}, total_files={len(files)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
