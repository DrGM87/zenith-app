"""
Inspect all staged items in Zenith, with full folder browsing.
Run while Zenith is running.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:7890"


def req(method, path, data=None):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(
        url, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {}
    )
    with urllib.request.urlopen(r, timeout=5) as resp:
        return json.loads(resp.read().decode())


def fmt_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def main():
    print("\n=== Zenith Staged Items Inspector ===\n")

    items = req("GET", "/items")
    if not items:
        print("  (no items staged)")
        return

    print(f"Total staged items: {len(items)}\n")

    for i, item in enumerate(items):
        prefix = f"[{i+1}]"
        kind = "FOLDER" if item["is_directory"] else "FILE"
        print(f"{prefix} {kind}: {item['name']}")
        print(f"    ID:        {item['id']}")
        print(f"    Path:      {item['path']}")
        print(f"    Size:      {fmt_size(item['size'])}")
        print(f"    Extension: {item['extension'] or '(none)'}")
        print(f"    MIME:      {item['mime_type']}")
        print(f"    Thumbnail: {'yes' if item['thumbnail'] else 'no'}")

        if item["is_directory"] and item["path"]:
            print(f"\n    --- Contents of {item['name']}/ ---")
            try:
                encoded_id = urllib.parse.quote(item["id"], safe="")
                children = req("GET", f"/browse/{encoded_id}")
                total_size = sum(c["size"] for c in children)
                dirs = [c for c in children if c["is_directory"]]
                files = [c for c in children if not c["is_directory"]]

                print(f"    {len(files)} file(s), {len(dirs)} subfolder(s), total {fmt_size(total_size)}\n")

                for c in children:
                    if c["is_directory"]:
                        sub_count = c.get("children_count")
                        sub_str = f"({sub_count} items)" if sub_count is not None else ""
                        print(f"      [DIR]  {c['name']}/  {sub_str}")
                    else:
                        print(f"      [FILE] {c['name']:45s} {fmt_size(c['size']):>10s}  {c['mime_type']}")
            except Exception as e:
                print(f"    (browse failed: {e})")

        print()


if __name__ == "__main__":
    main()
