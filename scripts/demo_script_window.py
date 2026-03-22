"""
Demo: Open a Zenith Script Window showing staged items summary.
Run while Zenith is running.

Usage:
    python scripts/demo_script_window.py
"""

import json
import time
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


def build_html(items):
    total_size = sum(i["size"] for i in items)
    dirs = [i for i in items if i["is_directory"]]
    files = [i for i in items if not i["is_directory"]]

    html = f"""
    <div class="grid-3" style="margin-bottom: 12px;">
      <div class="card stat">
        <div class="stat-value">{len(items)}</div>
        <div class="stat-label">Total Items</div>
      </div>
      <div class="card stat">
        <div class="stat-value">{len(dirs)}</div>
        <div class="stat-label">Folders</div>
      </div>
      <div class="card stat">
        <div class="stat-value">{fmt_size(total_size)}</div>
        <div class="stat-label">Total Size</div>
      </div>
    </div>
    """

    if not items:
        html += '<p style="text-align:center; opacity:0.4;">No items staged. Drop some files into Zenith!</p>'
        return html

    html += "<h2>Staged Items</h2>"
    html += '<table><tr><th>Name</th><th>Type</th><th>Size</th></tr>'

    for item in items:
        kind = '<span class="badge badge-info">DIR</span>' if item["is_directory"] else f'<span class="badge badge-success">{item["extension"].upper() or "FILE"}</span>'
        html += f'<tr><td>{item["name"]}</td><td>{kind}</td><td>{fmt_size(item["size"])}</td></tr>'

        # If it's a directory, show its contents
        if item["is_directory"] and item["path"]:
            try:
                encoded_id = urllib.parse.quote(item["id"], safe="")
                children = req("GET", f"/browse/{encoded_id}")
                for child in children:
                    c_kind = '<span class="badge badge-info" style="font-size:0.7em;">DIR</span>' if child["is_directory"] else f'<span class="badge badge-success" style="font-size:0.7em;">{child["extension"].upper()}</span>'
                    html += f'<tr><td style="padding-left:28px; opacity:0.7;">&rarr; {child["name"]}</td><td>{c_kind}</td><td>{fmt_size(child["size"])}</td></tr>'
            except Exception:
                pass

    html += "</table>"

    html += """
    <hr>
    <p style="opacity:0.35; font-size:0.8em; text-align:center;">
        Auto-refreshes every 3 seconds &bull; Powered by Zenith API
    </p>
    """
    return html


def main():
    print("Zenith Script Window Demo")
    print("=" * 40)

    # Check if Zenith is running
    try:
        req("GET", "/health")
    except Exception:
        print("ERROR: Cannot connect to Zenith API. Is Zenith running?")
        return

    print("Connected to Zenith API")
    print("Opening script window...")

    # Get staged items and build HTML
    items = req("GET", "/items")
    html = build_html(items)

    # Open the script window
    req("POST", "/window/open", {
        "title": "Staged Items Dashboard",
        "html": html,
        "width": 400,
        "height": 450,
    })

    print("Script window opened! Refreshing every 3 seconds...")
    print("Press Ctrl+C to stop.\n")

    try:
        while True:
            time.sleep(3)
            try:
                items = req("GET", "/items")
                html = build_html(items)
                req("POST", "/window/update", {
                    "title": f"Dashboard ({len(items)} items)",
                    "html": html,
                })
                print(f"  Refreshed: {len(items)} items staged")
            except Exception as e:
                print(f"  Refresh failed: {e}")
    except KeyboardInterrupt:
        print("\nClosing script window...")
        try:
            req("DELETE", "/window")
        except Exception:
            pass
        print("Done.")


if __name__ == "__main__":
    main()
