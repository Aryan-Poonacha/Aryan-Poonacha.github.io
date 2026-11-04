#!/usr/bin/env python3
"""Verify deployment preservation against a disposable local Git remote. No GitHub writes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
WORK = Path.home() / ".local/share/device-agent/work" / ("portfolio-deploy-proof-" + str(time.time_ns()))
WORK.mkdir(parents=True)
repo = WORK / "source"
remote = WORK / "origin.git"


def run(*args, cwd=repo):
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.STDOUT).decode()


def write(path, text):
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def commit(message):
    run("git", "add", ".")
    run("git", "commit", "-m", message)


def show(path):
    return run("git", "show", "origin/portfolio-live:" + path)


subprocess.check_output(["git", "init", "--bare", str(remote)], stderr=subprocess.STDOUT)
subprocess.check_output(["git", "init", str(repo)], stderr=subprocess.STDOUT)
run("git", "config", "user.name", "Portfolio deployment proof")
run("git", "config", "user.email", "proof@example.invalid")
run("git", "remote", "add", "origin", str(remote))
legacy = "<title>Legacy exact snapshot</title>\n"
galaxy = "<!--content-head:start--><title>Draft heading</title><!--content-head:end--><main>renderer v1</main>"
write("index.html", legacy)
write("legacy.html", legacy)
write("galaxy.html", galaxy)
write(".nojekyll", "")
write("admin/index.html", "admin v1")
write("content/publishing.json", json.dumps({"liveBranch": "portfolio-live"}))
write("content/galaxy.json", json.dumps({"core": {"id": "core", "title": "Draft", "notes": "EDITOR_ONLY", "reviewed": True}, "domains": []}))
write("content/release.json", json.dumps({"view": "legacy"}))
write("assets/Aryan-Poonacha-Resume.pdf", "do not deploy")
write("assets/media/original.png", "media v1")
commit("Initial proof source")
run(sys.executable, str(ROOT / "tools/deploy.py"), "--push")
run("git", "fetch", "origin", "portfolio-live")
assert show("index.html") == legacy
assert "EDITOR_ONLY" not in show("content/galaxy.json")
assert "reviewed" not in show("content/galaxy.json")
deployed_files = run("git", "ls-tree", "-r", "--name-only", "origin/portfolio-live")
assert "Aryan-Poonacha-Resume.pdf" not in deployed_files
assert show("admin/index.html") == "admin v1"
print("PASS first deployment preserves exact Legacy, excludes CV and editor notes")
assert "Already deployed" in run(sys.executable, str(ROOT / "tools/deploy.py"), "--push")
print("PASS repeat deployment is idempotent")
# Simulate a real publication on the isolated live branch.
run("git", "switch", "-c", "live", "origin/portfolio-live")
reviewed_head = "<!--content-head:start--><title>Reviewed heading</title><!--content-head:end-->"
write("index.html", reviewed_head + "<main>renderer v1</main>")
write("content/galaxy.json", '{"published":"carefully reviewed"}\n')
published_release = '{"view":"galaxy","publishedAt":"verified","draftCommit":"saved"}\n'
write("content/release.json", published_release)
write("assets/media/uploaded.png", "immutable upload")
commit("Publish reviewed galaxy")
run("git", "push", "origin", "HEAD:portfolio-live")
run("git", "switch", "-")
write("galaxy.html", galaxy.replace("renderer v1", "renderer v2"))
write("admin/index.html", "admin v2")
write("content/galaxy.json", '{"unpublished":"must stay draft"}\n')
commit("Improve code without publishing draft")
run(sys.executable, str(ROOT / "tools/deploy.py"), "--push")
run("git", "fetch", "origin", "portfolio-live")
assert show("content/galaxy.json") == '{"published":"carefully reviewed"}\n'
assert show("content/release.json") == published_release
assert show("assets/media/uploaded.png") == "immutable upload"
assert show("admin/index.html") == "admin v2"
assert show("index.html") == reviewed_head + "<main>renderer v2</main>"
print("PASS code update preserves approved Galaxy, metadata, release and uploaded media")
print(json.dumps({"ok": True, "cases": 3, "workspace": str(WORK)}))
