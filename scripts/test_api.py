"""
Zenith API Integration Test
============================
Run this while Zenith is running to verify the API works correctly.

Usage:
    python scripts/test_api.py
"""

import json
import os
import sys
import tempfile
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:7890"
passed = 0
failed = 0


def req(method, path, data=None):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(
        url, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {}
    )
    with urllib.request.urlopen(r, timeout=5) as resp:
        return resp.status, json.loads(resp.read().decode())


def test(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  PASS  {name}")
        passed += 1
    except Exception as e:
        print(f"  FAIL  {name}: {e}")
        failed += 1


def test_health():
    status, body = req("GET", "/health")
    assert status == 200, f"Expected 200, got {status}"
    assert body["status"] == "ok", f"Expected ok, got {body}"
    assert body["app"] == "zenith", f"Expected zenith, got {body}"


def test_clear():
    status, body = req("DELETE", "/items")
    assert status == 200
    assert body["status"] == "cleared"


def test_list_empty():
    req("DELETE", "/items")
    status, body = req("GET", "/items")
    assert status == 200
    assert isinstance(body, list)
    assert len(body) == 0, f"Expected empty list, got {len(body)} items"


def test_stage_file():
    # Create a temp file to stage
    fd, path = tempfile.mkstemp(suffix=".txt", prefix="zenith_test_")
    os.write(fd, b"Hello from Zenith test!")
    os.close(fd)
    try:
        # Normalize path to backslashes on Windows
        path = os.path.normpath(path)
        status, body = req("POST", "/stage/file", {"path": path})
        assert status == 200, f"Expected 200, got {status}"
        assert body["name"].startswith("zenith_test_"), f"Bad name: {body['name']}"
        assert body["extension"] == "txt", f"Bad ext: {body['extension']}"
        assert body["size"] > 0, f"Bad size: {body['size']}"
        norm_resp = os.path.normpath(body["path"])
        assert norm_resp == path, f"Bad path: {norm_resp} != {path}"
    finally:
        os.unlink(path)


def test_stage_file_not_found():
    try:
        req("POST", "/stage/file", {"path": "C:\\nonexistent\\fake.txt"})
        assert False, "Should have raised an error"
    except urllib.error.HTTPError as e:
        assert e.code == 404, f"Expected 404, got {e.code}"


def test_stage_text():
    status, body = req("POST", "/stage/text", {"text": "Test snippet from API"})
    assert status == 200
    assert body["name"] == "Test snippet from API"
    assert body["size"] == 21
    assert body["mime_type"] == "text/plain"


def test_stage_text_long():
    long_text = "A" * 100
    status, body = req("POST", "/stage/text", {"text": long_text})
    assert status == 200
    assert body["name"].endswith("..."), f"Long text should be truncated: {body['name']}"
    assert body["size"] == 100


def test_list_after_staging():
    req("DELETE", "/items")
    req("POST", "/stage/text", {"text": "item 1"})
    req("POST", "/stage/text", {"text": "item 2"})
    status, body = req("GET", "/items")
    assert status == 200
    assert len(body) == 2, f"Expected 2 items, got {len(body)}"


def test_clear_all():
    req("POST", "/stage/text", {"text": "to be cleared"})
    req("DELETE", "/items")
    status, body = req("GET", "/items")
    assert len(body) == 0, f"Expected 0 items after clear, got {len(body)}"


def test_bad_json():
    try:
        url = f"{BASE}/stage/file"
        r = urllib.request.Request(
            url, data=b"not json", method="POST",
            headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(r, timeout=5)
        assert False, "Should have raised an error"
    except urllib.error.HTTPError as e:
        assert e.code == 400, f"Expected 400, got {e.code}"


def test_unknown_endpoint():
    try:
        req("GET", "/nonexistent")
        assert False, "Should have raised an error"
    except urllib.error.HTTPError as e:
        assert e.code == 404, f"Expected 404, got {e.code}"


if __name__ == "__main__":
    print("\nZenith API Integration Tests")
    print("=" * 40)

    # Check if Zenith is running
    try:
        req("GET", "/health")
    except Exception:
        print("\nERROR: Cannot connect to Zenith API at", BASE)
        print("Make sure Zenith is running first.")
        sys.exit(1)

    tests = [
        ("Health check", test_health),
        ("Clear items", test_clear),
        ("List empty", test_list_empty),
        ("Stage file", test_stage_file),
        ("Stage file not found", test_stage_file_not_found),
        ("Stage text", test_stage_text),
        ("Stage long text (truncation)", test_stage_text_long),
        ("List after staging", test_list_after_staging),
        ("Clear all", test_clear_all),
        ("Bad JSON request", test_bad_json),
        ("Unknown endpoint", test_unknown_endpoint),
    ]

    for name, fn in tests:
        test(name, fn)

    # Clean up
    try:
        req("DELETE", "/items")
    except Exception:
        pass

    print("=" * 40)
    print(f"Results: {passed} passed, {failed} failed")

    if failed > 0:
        sys.exit(1)
    else:
        print("All tests passed!")
        sys.exit(0)
