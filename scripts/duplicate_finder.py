"""
Zenith Duplicate Finder Script
================================
Scans staged files (including folder contents) and identifies
identical files using SHA-256 hash matching, even if they have
different names.

Usage:
    python scripts/duplicate_finder.py
"""

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

ZENITH = "http://127.0.0.1:7890"


def zenith_req(method, path, data=None):
    url = f"{ZENITH}{path}"
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(
        url, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(r, timeout=10) as resp:
        return json.loads(resp.read().decode())


def poll_events():
    try:
        return zenith_req("GET", "/window/events")
    except Exception:
        return []


def set_ui(title, components, pinned=True):
    zenith_req("POST", "/window/update", {
        "title": title,
        "components": components,
        "pinned": pinned,
        "width": 400,
        "height": 460,
    })


def open_ui(title, components, pinned=True):
    zenith_req("POST", "/window/open", {
        "title": title,
        "components": components,
        "pinned": pinned,
        "width": 400,
        "height": 460,
    })


def fmt_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def hash_file(path, block_size=65536):
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            while True:
                data = f.read(block_size)
                if not data:
                    break
                h.update(data)
        return h.hexdigest()
    except Exception:
        return None


def collect_all_files(items):
    files = []
    for item in items:
        if item.get("is_directory") and item.get("path"):
            try:
                encoded = urllib.parse.quote(item["id"], safe="")
                children = zenith_req("GET", f"/browse/{encoded}")
                for child in children:
                    if not child.get("is_directory"):
                        files.append({
                            "name": child["name"],
                            "path": child["path"],
                            "size": child["size"],
                            "parent": item["name"],
                        })
            except Exception:
                pass
        elif not item.get("is_directory"):
            files.append({
                "name": item["name"],
                "path": item.get("path", ""),
                "size": item["size"],
                "parent": None,
            })
    return files


def find_duplicates(files):
    hash_map = {}
    for f in files:
        if not f["path"] or not os.path.isfile(f["path"]):
            continue
        fhash = hash_file(f["path"])
        if fhash is None:
            continue
        if fhash not in hash_map:
            hash_map[fhash] = []
        hash_map[fhash].append(f)

    duplicates = {h: group for h, group in hash_map.items() if len(group) > 1}
    return duplicates


def build_main_ui(files, duplicates=None, scanning=False):
    comps = [
        {"type": "label", "text": "Duplicate Finder", "style": "heading"},
        {"type": "grid", "columns": 2, "children": [
            {"type": "stat", "label": "Files Staged", "value": str(len(files))},
            {"type": "stat", "label": "Method", "value": "SHA-256"},
        ]},
    ]

    if scanning:
        comps.append({"type": "progress", "label": "Hashing files...", "value": 50})
        comps.append({"type": "button", "id": "scan", "label": "Scanning...",
                       "variant": "primary", "loading": True, "disabled": True})
        return comps

    if duplicates is not None:
        dup_count = sum(len(g) for g in duplicates.values())
        group_count = len(duplicates)

        comps.append({"type": "grid", "columns": 2, "children": [
            {"type": "stat", "label": "Duplicate Groups", "value": str(group_count)},
            {"type": "stat", "label": "Duplicate Files", "value": str(dup_count)},
        ]})

        if group_count == 0:
            comps.append({"type": "divider"})
            comps.append({"type": "label", "text": "No duplicates found. All files are unique.", "style": "success"})
        else:
            comps.append({"type": "divider"})
            for i, (h, group) in enumerate(duplicates.items()):
                short_hash = h[:12]
                size = fmt_size(group[0]["size"])
                card_children = [
                    {"type": "label", "text": f"Hash: {short_hash}...  |  Size: {size}", "style": "muted"},
                ]
                for f in group:
                    loc = f["parent"] or "root"
                    card_children.append(
                        {"type": "text", "text": f"  {f['name']}  ({loc})"}
                    )
                comps.append({"type": "card", "title": f"Group {i+1} ({len(group)} files)", "children": card_children})

        comps.append({"type": "spacer", "height": 4})
        comps.append({"type": "button_group", "children": [
            {"type": "button", "id": "rescan", "label": "Rescan", "variant": "primary"},
        ]})
    else:
        comps.append({"type": "divider"})
        comps.append({"type": "button_group", "children": [
            {"type": "button", "id": "scan", "label": "Scan for Duplicates", "variant": "primary",
             "disabled": len(files) == 0},
        ]})

    return comps


def main():
    print("Zenith Duplicate Finder")
    print("=" * 40)

    try:
        zenith_req("GET", "/health")
    except Exception:
        print("ERROR: Zenith not running.")
        return

    items = zenith_req("GET", "/items")
    files = collect_all_files(items)
    duplicates = None

    open_ui("Duplicate Finder", build_main_ui(files))
    print("Script window opened. Waiting for events...")

    try:
        while True:
            time.sleep(0.3)
            events = poll_events()

            for ev in events:
                eid = ev.get("id")
                etype = ev.get("type")

                if etype == "click" and eid in ("scan", "rescan"):
                    items = zenith_req("GET", "/items")
                    files = collect_all_files(items)
                    set_ui("Duplicate Finder", build_main_ui(files, scanning=True))

                    duplicates = find_duplicates(files)
                    dup_count = sum(len(g) for g in duplicates.values())
                    print(f"  Scan complete: {len(duplicates)} groups, {dup_count} duplicate files")

                    set_ui("Duplicate Finder", build_main_ui(files, duplicates))

    except KeyboardInterrupt:
        print("\nClosing...")
        try:
            zenith_req("DELETE", "/window")
        except Exception:
            pass


if __name__ == "__main__":
    main()
