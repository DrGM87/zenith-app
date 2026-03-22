"""
Zenith API Client
=================
Stage files and text into Zenith from any Python script.

Usage:
    from zenith_api import ZenithAPI
    api = ZenithAPI()
    api.stage_file(r"C:\path\to\file.txt")
    api.stage_text("Hello from Python!")
    items = api.list_items()
    api.clear_all()
"""

import json
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "http://127.0.0.1:7890"


class ZenithAPI:
    def __init__(self, base_url: str = BASE_URL):
        self.base_url = base_url

    def _request(self, method: str, path: str, data: dict | None = None) -> dict:
        url = f"{self.base_url}{path}"
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(
            url, data=body, method=method,
            headers={"Content-Type": "application/json"} if body else {}
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.URLError as e:
            raise ConnectionError(
                f"Cannot reach Zenith API at {self.base_url}. Is Zenith running?\n{e}"
            )

    def health(self) -> dict:
        """Check if Zenith API is running."""
        return self._request("GET", "/health")

    def stage_file(self, path: str) -> dict:
        """Stage a file by its absolute path."""
        return self._request("POST", "/stage/file", {"path": path})

    def stage_text(self, text: str) -> dict:
        """Stage a text snippet."""
        return self._request("POST", "/stage/text", {"text": text})

    def list_items(self) -> list:
        """List all currently staged items."""
        return self._request("GET", "/items")

    def clear_all(self) -> dict:
        """Clear all staged items."""
        return self._request("DELETE", "/items")

    def browse_item(self, item_id: str) -> list:
        """Browse contents of a staged directory by its item ID."""
        encoded = urllib.parse.quote(item_id, safe="")
        return self._request("GET", f"/browse/{encoded}")

    def browse_path(self, path: str) -> list:
        """Browse contents of any directory by absolute path."""
        return self._request("POST", "/browse", {"path": path})


if __name__ == "__main__":
    import sys

    api = ZenithAPI()

    if len(sys.argv) < 2:
        print("Zenith API Client")
        print("  python zenith_api.py health")
        print("  python zenith_api.py list")
        print('  python zenith_api.py stage-file "C:\\path\\to\\file"')
        print('  python zenith_api.py stage-text "some text"')
        print("  python zenith_api.py clear")
        sys.exit(0)

    cmd = sys.argv[1]
    try:
        if cmd == "health":
            print(api.health())
        elif cmd == "list":
            items = api.list_items()
            for item in items:
                print(f"  [{item['id'][:12]}] {item['name']} ({item['size']} bytes)")
            if not items:
                print("  (no items staged)")
        elif cmd == "stage-file" and len(sys.argv) >= 3:
            result = api.stage_file(sys.argv[2])
            print(f"Staged: {result['name']}")
        elif cmd == "stage-text" and len(sys.argv) >= 3:
            result = api.stage_text(sys.argv[2])
            print(f"Staged text: {result['name']}")
        elif cmd == "clear":
            print(api.clear_all())
        else:
            print(f"Unknown command: {cmd}")
    except ConnectionError as e:
        print(f"Error: {e}")
