#!/usr/bin/env python3
"""Build the Pages branch without changing main, drafts, or the selected live view.

python3 tools/deploy.py [--source HEAD] [--push]
Prints a commit for inspection by default. --push advances only portfolio-live.
The first deployment serves the exact legacy homepage. Later deployments retain the
published content, release metadata and uploaded media. Concurrent releases reject the push.
"""
import argparse
import json
import re
import subprocess


def git(*args, data=None, check=True):
    return subprocess.run(["git", *args], input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=check).stdout


def files(ref):
    result = {}
    for entry in git("ls-tree", "-rz", ref).split(b"\0"):
        if not entry:
            continue
        meta, path = entry.split(b"\t", 1)
        mode, kind, sha = meta.decode().split()
        if kind == "blob":
            result[path.decode()] = (mode, sha)
    return result


def blob(text):
    return ("100644", git("hash-object", "-w", "--stdin", data=text.encode()).decode().strip())


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()
                if k not in ("notes", "reviewed") and not k.startswith("_")}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def make_tree(items):
    groups = {}
    leaves = []
    for path, (mode, sha) in items.items():
        if "/" in path:
            first, rest = path.split("/", 1)
            groups.setdefault(first, {})[rest] = (mode, sha)
        else:
            leaves.append(f"{mode} blob {sha}\t{path}".encode() + b"\0")
    for name, children in groups.items():
        leaves.append(f"040000 tree {make_tree(children)}\t{name}".encode() + b"\0")
    return git("mktree", "-z", data=b"".join(leaves)).decode().strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", default="HEAD")
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()
    source = files(args.source)
    config = json.loads(git("show", f"{args.source}:content/publishing.json"))
    branch = config["liveBranch"]
    if branch != "portfolio-live":
        raise SystemExit("Only portfolio-live may be deployed by this tool")
    remote = git("ls-remote", "origin", f"refs/heads/{branch}").decode().split()
    parent = remote[0] if remote else None
    previous = {}
    if parent:
        git("fetch", "origin", branch)
        previous = files(parent)
    allowed = ("admin/", "js/", "css/", "assets/")
    names = {"index.html", "galaxy.html", "legacy.html", ".nojekyll",
             "content/galaxy.json", "content/publishing.json", "content/release.json"}
    output = {p: v for p, v in source.items() if p in names or p.startswith(allowed)}
    # The restored legacy site never published this personal PDF. Do not reintroduce it.
    output.pop("assets/Aryan-Poonacha-Resume.pdf", None)
    if previous:
        for path in ("content/galaxy.json", "content/release.json"):
            output[path] = previous[path]
        output.update({p: v for p, v in previous.items() if p.startswith("assets/media/")})
        release = json.loads(git("cat-file", "blob", previous["content/release.json"][1]))
    else:
        content = json.loads(git("show", f"{args.source}:content/galaxy.json"))
        output["content/galaxy.json"] = blob(json.dumps(clean(content), ensure_ascii=False, indent=2) + "\n")
        release = {"view": "legacy", "publishedAt": None, "draftCommit": None}
        output["content/release.json"] = blob(json.dumps(release, indent=2) + "\n")
    if release["view"] not in ("legacy", "galaxy"):
        raise SystemExit("Invalid live view; refusing deployment")
    output["index.html"] = output[release["view"] + ".html"]
    if release["view"] == "galaxy" and previous:
        # Retain the metadata approved in the last release while updating the renderer.
        old_page = git("cat-file", "blob", previous["index.html"][1]).decode()
        head = re.search(r"<!--content-head:start-->[\s\S]*?<!--content-head:end-->", old_page)
        if not head:
            raise SystemExit("Published galaxy metadata is missing; refusing deployment")
        new_page = git("cat-file", "blob", output["galaxy.html"][1]).decode()
        new_page = re.sub(r"<!--content-head:start-->[\s\S]*?<!--content-head:end-->", lambda _: head.group(), new_page)
        output["index.html"] = blob(new_page)
    tree = make_tree(output)
    if parent and git("rev-parse", parent + "^{tree}").decode().strip() == tree:
        print("Already deployed; selected live view: " + release["view"])
        return
    cmd = ["commit-tree", tree]
    if parent:
        cmd += ["-p", parent]
    source_sha = git("rev-parse", args.source).decode().strip()
    sha = git(*cmd, data=f"Update portfolio admin from {source_sha[:7]}; retain {release['view']} live\n".encode()).decode().strip()
    print(json.dumps({"commit": sha, "source": source_sha, "branch": branch,
                      "view": release["view"], "files": len(output), "pushed": args.push}))
    if args.push:
        # No force: a save or release since the snapshot prevents this deployment overwriting it.
        subprocess.run(["git", "push", "origin", f"{sha}:refs/heads/{branch}"], check=True)


if __name__ == "__main__":
    main()
