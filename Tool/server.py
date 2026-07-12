#!/usr/bin/env python3
"""Local server for Qualitative Analysis.

Serves the app itself, plus endpoints the frontend uses to auto-list and
save local files instead of going through browser downloads:
  GET  /api/list?dir=videos|transcripts  -> JSON array of filenames
  POST /api/save?dir=transcripts|projects&name=<file>  -> writes the
       request body to that file inside the given folder
Files under /videos/ and /transcripts/ are served with HTTP Range support
so the video player can seek instantly instead of downloading the whole
file first.
"""
import http.server
import json
import mimetypes
import os
import re
import socket
import socketserver
import threading
import webbrowser
from urllib.parse import unquote, urlsplit, parse_qs

APP_DIR = os.path.dirname(os.path.abspath(__file__))       # Tool/ — app code, served as static files
DATA_ROOT = os.path.dirname(APP_DIR)                        # parent folder — videos/transcripts/projects live here
VIDEOS_DIR = os.path.join(DATA_ROOT, "videos")
TRANSCRIPTS_DIR = os.path.join(DATA_ROOT, "transcripts")
PROJECTS_DIR = os.path.join(DATA_ROOT, "projects")
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"}
TRANSCRIPT_EXTS = {".xlsx", ".xls", ".tsv", ".csv"}
SAVE_DIRS = {"transcripts": TRANSCRIPTS_DIR, "projects": PROJECTS_DIR}

os.makedirs(VIDEOS_DIR, exist_ok=True)
os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
os.makedirs(PROJECTS_DIR, exist_ok=True)


def list_dir(path, exts):
    try:
        names = [n for n in os.listdir(path) if not n.startswith(".") and os.path.splitext(n)[1].lower() in exts]
    except FileNotFoundError:
        names = []
    return sorted(names, key=str.lower)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    # index.html/app.js/style.css change often during development, and
    # browsers cache static files across tabs (a "fresh" tab can still get a
    # stale app.js from a previous session's cache) — no-store on every
    # response keeps that from ever masking a real code change again.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/list":
            self.serve_list()
        elif path.startswith("/videos/") or path.startswith("/transcripts/"):
            self.serve_file_with_range(path)
        elif path in ("/", "/index.html"):
            self.serve_index()
        else:
            super().do_GET()

    # index.html loaded straight off disk always has the same URL ("/"), so
    # Cache-Control alone can't save a browser tab whose cache predates this
    # server code. Instead, stamp app.js/style.css's <script>/<link> tags with
    # a "?v=<mtime>" query string computed fresh on every request — a
    # different URL is a guaranteed cache miss no matter what the browser
    # already had stored, so a stale tab self-heals on its very next reload
    # with no hard-refresh or cache-clearing needed.
    def serve_index(self):
        html = open(os.path.join(APP_DIR, "index.html"), "r", encoding="utf-8").read()
        for asset in ("app.js", "style.css"):
            version = int(os.path.getmtime(os.path.join(APP_DIR, asset)))
            html = html.replace(f'"{asset}"', f'"{asset}?v={version}"')
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if urlsplit(self.path).path == "/api/save":
            self.handle_save()
        else:
            self.send_error(404)

    def handle_save(self):
        qs = parse_qs(urlsplit(self.path).query)
        target_dir = SAVE_DIRS.get(qs.get("dir", [""])[0])
        # ponytail: single-user localhost-only server, so basename-stripping
        # (blocks "../" traversal) is enough trust-boundary checking here.
        name = os.path.basename(qs.get("name", [""])[0])
        if not target_dir or not name:
            self.send_error(400, "Missing or invalid dir/name")
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        with open(os.path.join(target_dir, name), "wb") as f:
            f.write(body)
        resp = json.dumps({"ok": True, "name": name}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def serve_list(self):
        kind = parse_qs(urlsplit(self.path).query).get("dir", [""])[0]
        if kind == "videos":
            items = list_dir(VIDEOS_DIR, VIDEO_EXTS)
        elif kind == "transcripts":
            items = list_dir(TRANSCRIPTS_DIR, TRANSCRIPT_EXTS)
        else:
            items = []
        body = json.dumps(items).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_file_with_range(self, path):
        full = os.path.join(DATA_ROOT, unquote(path).lstrip("/"))
        if not os.path.isfile(full):
            self.send_error(404, "File not found")
            return
        file_size = os.path.getsize(full)
        content_type = mimetypes.guess_type(full)[0] or "application/octet-stream"
        range_header = self.headers.get("Range")
        start, end = 0, file_size - 1
        status = 200
        if range_header:
            match = re.match(r"bytes=(\d*)-(\d*)", range_header)
            if match:
                start_s, end_s = match.groups()
                start = int(start_s) if start_s else 0
                end = min(int(end_s), file_size - 1) if end_s else file_size - 1
                status = 206

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

        try:
            with open(full, "rb") as f:
                f.seek(start)
                remaining = end - start + 1
                chunk = 256 * 1024
                while remaining > 0:
                    data = f.read(min(chunk, remaining))
                    if not data:
                        break
                    self.wfile.write(data)
                    remaining -= len(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # the browser aborted this request (e.g. seeking cut it short) — not an error

    def log_message(self, fmt, *args):
        pass  # ponytail: quiet by default, this runs in a window the user keeps open


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def find_open_port(start=8420, tries=50):
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


def main():
    port = find_open_port()
    httpd = Server(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    print(f"Qualitative Analysis running at {url}")
    print(f"Videos folder:      {VIDEOS_DIR}")
    print(f"Transcripts folder: {TRANSCRIPTS_DIR}")
    print(f"Projects folder:    {PROJECTS_DIR}")
    print("Keep this window open while you work. Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
