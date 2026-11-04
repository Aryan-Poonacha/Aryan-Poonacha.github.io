#!/usr/bin/env python3
"""Serve the site on this computer with the content editor at /admin/, saving straight into this checkout.

    python3 tools/edit.py              # opens http://127.0.0.1:4000/admin/
    python3 tools/edit.py --port 4100 --no-open

Only content/galaxy.json and new files under assets/media/ can be written, and only from this
computer. Each save of the content first copies the previous version to content/.backups/.
Commit and push with git as usual; nothing here publishes the site.
"""
import argparse
import datetime
import http.server
import json
import os
import re
import socketserver
import sys
import tempfile
import threading
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = "content/galaxy.json"
MEDIA = "assets/media/"
BACKUPS = os.path.join(ROOT, "content", ".backups")
KEEP_BACKUPS = 50
MAX_BYTES = 200 * 1024 * 1024
WRITE_LOCK = threading.Lock()
MEDIA_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,80}\.(mp4|webm|webp|jpg|jpeg|png|gif|avif|svg|pdf)$")


class Handler(http.server.SimpleHTTPRequestHandler):
    backups = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.command != "GET":
            sys.stderr.write("%s %s\n" % (self.command, fmt % args))

    def reply(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def local_host(self):
        """Every request must name this computer, so a site that rebinds its own name to 127.0.0.1 gets nothing."""
        return self.headers.get("Host", "") in ("127.0.0.1:%d" % self.server.server_port, "localhost:%d" % self.server.server_port)

    def same_origin(self):
        """Writes come only from pages this server served: a local Host, and a matching Origin when one is sent."""
        origin = self.headers.get("Origin")
        return self.local_host() and (origin is None or urllib.parse.urlsplit(origin).netloc == self.headers.get("Host"))

    def do_HEAD(self):
        if not self.local_host():
            return self.reply(403, {"error": "Only from this computer"})
        super().do_HEAD()

    def do_GET(self):
        if not self.local_host():
            return self.reply(403, {"error": "Only from this computer"})
        if urllib.parse.urlsplit(self.path).path == "/__admin/ping":
            return self.reply(200, {"ok": True, "content": CONTENT, "media": MEDIA, "root": ROOT})
        super().do_GET()

    def do_PUT(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path != "/__admin/file":
            return self.reply(404, {"error": "Not found"})
        if not self.same_origin():
            return self.reply(403, {"error": "Writes are only accepted from the editor on this computer"})
        rel = urllib.parse.parse_qs(url.query).get("path", [""])[0]
        size = int(self.headers.get("Content-Length") or 0)
        if size > MAX_BYTES:
            return self.reply(413, {"error": "Over %d MB" % (MAX_BYTES // 2**20)})
        data = self.rfile.read(size)
        name = rel[len(MEDIA):] if rel.startswith(MEDIA) else ""
        with WRITE_LOCK:
            if rel == CONTENT:
                return self.save_content(data)
            if not MEDIA_NAME.match(name):
                return self.reply(400, {"error": "Only content/galaxy.json and assets/media/<name> can be written"})
            return self.save_media(rel, data, urllib.parse.parse_qs(url.query).get("replace", ["0"])[0] == "1")

    def save_content(self, data):
        try:
            parsed = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as e:
            return self.reply(400, {"error": "Not valid JSON: %s" % e})
        if not isinstance(parsed, dict) or "core" not in parsed or "domains" not in parsed:
            return self.reply(400, {"error": "Not a galaxy content file (no core or domains)"})
        path = os.path.join(ROOT, CONTENT)
        if self.backups and os.path.exists(path):
            os.makedirs(BACKUPS, exist_ok=True)
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
            with open(path, "rb") as src, open(os.path.join(BACKUPS, "galaxy-%s.json" % stamp), "wb") as dst:
                dst.write(src.read())
            old = sorted(f for f in os.listdir(BACKUPS) if f.startswith("galaxy-"))
            for f in old[:-KEEP_BACKUPS]:
                os.remove(os.path.join(BACKUPS, f))
        write_atomic(path, data)
        return self.reply(200, {"ok": True, "path": CONTENT, "bytes": len(data)})

    def save_media(self, rel, data, replace):
        path = os.path.join(ROOT, rel)
        if os.path.exists(path) and not replace:
            with open(path, "rb") as f:
                if f.read() != data:
                    return self.reply(409, {"error": "%s already exists" % rel, "exists": True})
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write_atomic(path, data)
        return self.reply(200, {"ok": True, "path": rel, "bytes": len(data)})


def write_atomic(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".edit-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, help="exact port (default: the first free one from 4000)")
    ap.add_argument("--no-open", action="store_true", help="do not open a browser")
    ap.add_argument("--no-backups", action="store_true", help="do not copy the previous content to content/.backups/")
    args = ap.parse_args()
    Handler.backups = not args.no_backups
    server = None
    for port in [args.port] if args.port else range(4000, 4020):
        try:
            server = Server(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if not server:
        sys.exit("Port %d is in use" % args.port if args.port else "No free port from 4000")
    url = "http://127.0.0.1:%d/admin/" % server.server_port
    print("Editor: %s\nSite:   http://127.0.0.1:%d/\nSaving into %s\nCtrl+C to stop." % (url, server.server_port, os.path.join(ROOT, CONTENT)), flush=True)
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
