"""
Zenith AI Summarizer Script
============================
Reads staged files, sends their text content to OpenAI or Gemini,
and displays a summary in a Zenith script window.

Features:
  - BYOK (Bring Your Own Key) for OpenAI / Gemini
  - Model selection
  - Token counter
  - Custom prompt
  - Copy to clipboard / Retry buttons

Usage:
    python scripts/ai_summarizer.py
"""

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ZENITH = "http://127.0.0.1:7890"
CONFIG_PATH = os.path.join(os.path.dirname(__file__), ".ai_summarizer.json")

DEFAULT_CONFIG = {
    "provider": "openai",
    "api_key": "",
    "model": "gpt-4o-mini",
    "custom_prompt": "Summarize these files concisely. For each file, provide a brief summary of its content, then give an overall summary.",
    "max_tokens": 2048,
    "temperature": 0.5,
}


def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r") as f:
                saved = json.load(f)
                cfg = {**DEFAULT_CONFIG, **saved}
                return cfg
        except Exception:
            pass
    return dict(DEFAULT_CONFIG)


def save_config(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


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
        "width": 420,
        "height": 520,
    })


def open_ui(title, components, pinned=True):
    zenith_req("POST", "/window/open", {
        "title": title,
        "components": components,
        "pinned": pinned,
        "width": 420,
        "height": 520,
    })


def count_tokens_approx(text):
    return len(text) // 4


def read_file_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return None


def read_file_for_all(items):
    texts = []
    for item in items:
        if item.get("is_directory"):
            try:
                encoded = urllib.parse.quote(item["id"], safe="")
                children = zenith_req("GET", f"/browse/{encoded}")
                for child in children:
                    if not child.get("is_directory"):
                        content = read_file_text(child["path"])
                        if content:
                            texts.append({"name": child["name"], "content": content})
            except Exception:
                pass
        else:
            content = read_file_text(item.get("path", ""))
            if content:
                texts.append({"name": item["name"], "content": content})
    return texts


def call_openai(api_key, model, prompt, file_texts, max_tokens, temperature):
    messages = [{"role": "system", "content": prompt}]
    user_msg = ""
    for ft in file_texts:
        user_msg += f"\n\n--- {ft['name']} ---\n{ft['content'][:8000]}"
    messages.append({"role": "user", "content": user_msg.strip()})

    body = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }).encode()

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    choice = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    return choice, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)


def call_gemini(api_key, model, prompt, file_texts, max_tokens, temperature):
    parts = [{"text": prompt}]
    for ft in file_texts:
        parts.append({"text": f"\n--- {ft['name']} ---\n{ft['content'][:8000]}"})

    body = json.dumps({
        "contents": [{"parts": parts}],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
        },
    }).encode()

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())

    text = data["candidates"][0]["content"]["parts"][0]["text"]
    usage = data.get("usageMetadata", {})
    return text, usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0)


OPENAI_MODELS = [
    {"label": "GPT-4o Mini", "value": "gpt-4o-mini"},
    {"label": "GPT-4o", "value": "gpt-4o"},
    {"label": "GPT-4 Turbo", "value": "gpt-4-turbo"},
    {"label": "GPT-3.5 Turbo", "value": "gpt-3.5-turbo"},
]

GEMINI_MODELS = [
    {"label": "Gemini 2.0 Flash", "value": "gemini-2.0-flash"},
    {"label": "Gemini 1.5 Flash", "value": "gemini-1.5-flash"},
    {"label": "Gemini 1.5 Pro", "value": "gemini-1.5-pro"},
]


def build_settings_ui(cfg):
    provider = cfg["provider"]
    models = OPENAI_MODELS if provider == "openai" else GEMINI_MODELS
    return [
        {"type": "label", "text": "AI Summarizer Settings", "style": "heading"},
        {"type": "divider"},
        {"type": "select", "id": "provider", "label": "Provider", "value": provider,
         "options": [{"label": "OpenAI", "value": "openai"}, {"label": "Google Gemini", "value": "gemini"}]},
        {"type": "input", "id": "api_key", "label": "API Key", "value": cfg["api_key"],
         "placeholder": "sk-... or AIza...", "password": True},
        {"type": "select", "id": "model", "label": "Model", "value": cfg["model"], "options": models},
        {"type": "multiline", "id": "prompt", "label": "System Prompt", "value": cfg["custom_prompt"], "rows": 3},
        {"type": "slider", "id": "temperature", "label": "Temperature",
         "min": 0, "max": 2, "step": 0.1, "value": cfg["temperature"]},
        {"type": "slider", "id": "max_tokens", "label": "Max Tokens",
         "min": 256, "max": 8192, "step": 256, "value": cfg["max_tokens"]},
        {"type": "divider"},
        {"type": "button_group", "children": [
            {"type": "button", "id": "save_settings", "label": "Save & Back", "variant": "primary"},
            {"type": "button", "id": "cancel_settings", "label": "Cancel"},
        ]},
    ]


def build_main_ui(cfg, items, summary=None, loading=False, error=None,
                   prompt_tokens=0, completion_tokens=0):
    file_count = 0
    for item in items:
        if item.get("is_directory"):
            try:
                encoded = urllib.parse.quote(item["id"], safe="")
                children = zenith_req("GET", f"/browse/{encoded}")
                file_count += len([c for c in children if not c.get("is_directory")])
            except Exception:
                file_count += 1
        else:
            file_count += 1

    provider_label = "OpenAI" if cfg["provider"] == "openai" else "Gemini"
    comps = [
        {"type": "label", "text": "AI Summarizer", "style": "heading"},
        {"type": "grid", "columns": 3, "children": [
            {"type": "stat", "label": "Files", "value": str(file_count)},
            {"type": "stat", "label": "Provider", "value": provider_label},
            {"type": "stat", "label": "Model", "value": cfg["model"]},
        ]},
    ]

    if not cfg["api_key"]:
        comps.append({"type": "label", "text": "No API key set. Open settings to configure.", "style": "warning"})

    if error:
        comps.append({"type": "label", "text": f"Error: {error}", "style": "error"})

    if loading:
        comps.append({"type": "progress", "label": "Generating summary...", "value": 50})
        comps.append({"type": "button", "id": "summarize", "label": "Summarizing...", "variant": "primary",
                       "loading": True, "disabled": True})
    elif summary:
        if prompt_tokens or completion_tokens:
            comps.append({"type": "grid", "columns": 2, "children": [
                {"type": "stat", "label": "Prompt Tokens", "value": str(prompt_tokens)},
                {"type": "stat", "label": "Reply Tokens", "value": str(completion_tokens)},
            ]})
        comps.append({"type": "divider"})
        comps.append({"type": "multiline", "id": "summary_text", "label": "Summary",
                       "value": summary, "rows": 10, "readonly": True})
        comps.append({"type": "button_group", "children": [
            {"type": "button", "id": "copy", "label": "Copy to Clipboard", "variant": "success"},
            {"type": "button", "id": "retry", "label": "Retry", "variant": "default"},
            {"type": "button", "id": "open_settings", "label": "Settings"},
        ]})
    else:
        comps.append({"type": "divider"})
        comps.append({"type": "button_group", "children": [
            {"type": "button", "id": "summarize", "label": "Summarize Files", "variant": "primary",
             "disabled": not cfg["api_key"] or file_count == 0},
            {"type": "button", "id": "open_settings", "label": "Settings"},
        ]})

    return comps


def main():
    print("Zenith AI Summarizer")
    print("=" * 40)

    try:
        zenith_req("GET", "/health")
    except Exception:
        print("ERROR: Zenith not running. Start Zenith first.")
        return

    cfg = load_config()
    items = zenith_req("GET", "/items")
    summary = None
    prompt_tokens = 0
    completion_tokens = 0
    error_msg = None
    mode = "main"

    ui = build_main_ui(cfg, items)
    open_ui("AI Summarizer", ui)
    print("Script window opened. Waiting for events...")

    try:
        while True:
            time.sleep(0.3)
            events = poll_events()

            for ev in events:
                eid = ev.get("id")
                etype = ev.get("type")
                evalue = ev.get("value")

                if etype == "click":
                    if eid == "open_settings":
                        mode = "settings"
                        set_ui("AI Summarizer - Settings", build_settings_ui(cfg))

                    elif eid == "save_settings":
                        save_config(cfg)
                        mode = "main"
                        items = zenith_req("GET", "/items")
                        set_ui("AI Summarizer", build_main_ui(cfg, items, summary,
                               prompt_tokens=prompt_tokens, completion_tokens=completion_tokens))

                    elif eid == "cancel_settings":
                        cfg = load_config()
                        mode = "main"
                        items = zenith_req("GET", "/items")
                        set_ui("AI Summarizer", build_main_ui(cfg, items, summary,
                               prompt_tokens=prompt_tokens, completion_tokens=completion_tokens))

                    elif eid == "summarize":
                        items = zenith_req("GET", "/items")
                        set_ui("AI Summarizer", build_main_ui(cfg, items, loading=True))

                        file_texts = read_file_for_all(items)
                        if not file_texts:
                            error_msg = "No readable files found."
                            set_ui("AI Summarizer", build_main_ui(cfg, items, error=error_msg))
                            continue

                        try:
                            if cfg["provider"] == "openai":
                                summary, prompt_tokens, completion_tokens = call_openai(
                                    cfg["api_key"], cfg["model"], cfg["custom_prompt"],
                                    file_texts, int(cfg["max_tokens"]), cfg["temperature"])
                            else:
                                summary, prompt_tokens, completion_tokens = call_gemini(
                                    cfg["api_key"], cfg["model"], cfg["custom_prompt"],
                                    file_texts, int(cfg["max_tokens"]), cfg["temperature"])
                            error_msg = None
                        except Exception as e:
                            error_msg = str(e)[:200]
                            summary = None

                        items = zenith_req("GET", "/items")
                        set_ui("AI Summarizer", build_main_ui(
                            cfg, items, summary, error=error_msg,
                            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens))

                    elif eid == "retry":
                        items = zenith_req("GET", "/items")
                        set_ui("AI Summarizer", build_main_ui(cfg, items, loading=True))

                        file_texts = read_file_for_all(items)
                        try:
                            if cfg["provider"] == "openai":
                                summary, prompt_tokens, completion_tokens = call_openai(
                                    cfg["api_key"], cfg["model"], cfg["custom_prompt"],
                                    file_texts, int(cfg["max_tokens"]), cfg["temperature"])
                            else:
                                summary, prompt_tokens, completion_tokens = call_gemini(
                                    cfg["api_key"], cfg["model"], cfg["custom_prompt"],
                                    file_texts, int(cfg["max_tokens"]), cfg["temperature"])
                            error_msg = None
                        except Exception as e:
                            error_msg = str(e)[:200]
                            summary = None

                        items = zenith_req("GET", "/items")
                        set_ui("AI Summarizer", build_main_ui(
                            cfg, items, summary, error=error_msg,
                            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens))

                    elif eid == "copy":
                        if summary:
                            try:
                                import subprocess
                                p = subprocess.Popen(["clip"], stdin=subprocess.PIPE)
                                p.communicate(summary.encode("utf-16-le"))
                                print("  Copied to clipboard.")
                            except Exception:
                                print("  Failed to copy to clipboard.")

                elif etype == "change" and mode == "settings":
                    if eid == "provider":
                        cfg["provider"] = evalue
                        if evalue == "openai":
                            cfg["model"] = "gpt-4o-mini"
                        else:
                            cfg["model"] = "gemini-2.0-flash"
                        set_ui("AI Summarizer - Settings", build_settings_ui(cfg))
                    elif eid == "api_key":
                        cfg["api_key"] = evalue
                    elif eid == "model":
                        cfg["model"] = evalue
                    elif eid == "prompt":
                        cfg["custom_prompt"] = evalue
                    elif eid == "temperature":
                        cfg["temperature"] = float(evalue)
                    elif eid == "max_tokens":
                        cfg["max_tokens"] = int(float(evalue))

    except KeyboardInterrupt:
        print("\nClosing...")
        try:
            zenith_req("DELETE", "/window")
        except Exception:
            pass


if __name__ == "__main__":
    main()
