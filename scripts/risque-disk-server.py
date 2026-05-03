#!/usr/bin/env python3
"""
RISQUE local disk API (optional; same routes as scripts/risque-disk-server.ps1).

Windows: RISQUE.ps1 starts risque-disk-server.ps1 automatically (no Python required).
Use this Python server only if you prefer `python risque-disk-server.py --root ...` instead.

Endpoints (JSON, CORS *):
  GET  /api/health
  POST /api/write        { "path": "GAME/RQSESS-.../file.json", "content": "<utf-8 text>" }
  POST /api/read         { "path": "..." }
  POST /api/list         { "dir": "REPLAY" }  — entries in that dir (one level)
  POST /api/delete-files { "paths": ["GAME/x/a.json", ...] }  — relative to save root
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any


def _norm_root(root: str) -> str:
    return os.path.normpath(os.path.abspath(os.path.expandvars(root.strip())))


def _safe_join(root: str, rel: str) -> str:
    rel = rel.replace("\\", "/").strip("/")
    parts = [p for p in rel.split("/") if p and p != "."]
    if any(p == ".." for p in parts):
        raise ValueError("invalid path")
    full = os.path.normpath(os.path.join(root, *parts))
    root_n = _norm_root(root)
    if not (full == root_n or full.startswith(root_n + os.sep)):
        raise ValueError("path outside save root")
    return full


class Handler(BaseHTTPRequestHandler):
    server_version = "RisqueDiskAPI/1.0"
    root: str = ""

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj: dict, code: int = 200) -> None:
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_body_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 120_000_000:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0].rstrip("/") == "/api/health":
            return self._json({"ok": True, "saveRoot": self.root})
        self.send_response(404)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:
        base = self.path.split("?", 1)[0].rstrip("/")
        body = self._read_body_json()
        try:
            if base == "/api/write":
                rel = str(body.get("path") or "")
                content = body.get("content")
                if content is None:
                    content = ""
                if not isinstance(content, str):
                    content = json.dumps(content)
                full = _safe_join(self.root, rel)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w", encoding="utf-8", newline="\n") as f:
                    f.write(content)
                return self._json({"ok": True, "path": rel})

            if base == "/api/read":
                rel = str(body.get("path") or "")
                full = _safe_join(self.root, rel)
                if not os.path.isfile(full):
                    return self._json({"ok": False, "error": "not found"}, 404)
                with open(full, "r", encoding="utf-8") as f:
                    txt = f.read()
                return self._json({"ok": True, "content": txt})

            if base == "/api/list":
                rel = str(body.get("dir") or "").strip("/")
                full = _safe_join(self.root, rel) if rel else self.root
                if not os.path.isdir(full):
                    return self._json({"ok": True, "entries": []})
                out = []
                for name in sorted(os.listdir(full)):
                    p = os.path.join(full, name)
                    is_dir = os.path.isdir(p)
                    ent = {"name": name, "kind": "directory" if is_dir else "file"}
                    if not is_dir:
                        try:
                            ent["mtimeMs"] = int(os.path.getmtime(p) * 1000)
                        except OSError:
                            ent["mtimeMs"] = 0
                    out.append(ent)
                return self._json({"ok": True, "entries": out})

            if base == "/api/delete-files":
                paths = body.get("paths") or []
                if not isinstance(paths, list):
                    return self._json({"ok": False, "error": "paths must be array"}, 400)
                removed = 0
                for rel in paths:
                    try:
                        full = _safe_join(self.root, str(rel))
                        if os.path.isfile(full):
                            os.remove(full)
                            removed += 1
                    except Exception:
                        pass
                return self._json({"ok": True, "removed": removed})

            if base == "/api/delete-prefix":
                rel_dir = str(body.get("dir") or "").strip("/")
                prefix = str(body.get("prefix") or "")
                if not rel_dir or not prefix:
                    return self._json({"ok": False, "error": "dir and prefix required"}, 400)
                dfull = _safe_join(self.root, rel_dir)
                if not os.path.isdir(dfull):
                    return self._json({"ok": True, "removed": 0})
                removed = 0
                for name in os.listdir(dfull):
                    if name.startswith(prefix):
                        try:
                            os.remove(os.path.join(dfull, name))
                            removed += 1
                        except Exception:
                            pass
                return self._json({"ok": True, "removed": removed})

        except ValueError as e:
            return self._json({"ok": False, "error": str(e)}, 400)
        except Exception as e:
            return self._json({"ok": False, "error": str(e)}, 500)

        self.send_response(404)
        self._cors()
        self.end_headers()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.environ.get("RISQUE_SAVE_ROOT", r"C:\RISQUE\SAVE"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("RISQUE_DISK_PORT", "5599")))
    ap.add_argument("--bind", default="127.0.0.1")
    ns = ap.parse_args()
    root = _norm_root(ns.root)
    os.makedirs(root, exist_ok=True)
    Handler.root = root

    class Server(HTTPServer):
        allow_reuse_address = True

    httpd = Server((ns.bind, ns.port), Handler)
    sys.stderr.write(
        "risque-disk-server saveRoot=%s http://%s:%s/api/health\n" % (root, ns.bind, ns.port)
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
