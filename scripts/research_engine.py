#!/usr/bin/env python3
"""Zenith Research Engine — AI-powered research assistant actions.
Provides: research_chat, search_papers, web_search_action, extract_pdf_text,
          check_novelty, verify_citations, run_experiment_action, export_chat,
          generate_section

Inspired by AutoResearchClaw (https://github.com/aiming-lab/AutoResearchClaw)
by Aiming Lab. Full credits in README.md.
"""
import os, sys, json, tempfile, time, re, random, urllib.request, urllib.error, urllib.parse

# ── Retry / rate-limit constants (mirrors AutoResearchClaw patterns) ──
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 2.0
_MAX_BACKOFF_SEC = 60
_RETRYABLE_CODES = frozenset({429, 500, 502, 503, 504, 529})
_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
_NO_TEMPERATURE_MODELS = frozenset({"o3", "o3-mini", "o4-mini", "deepseek-reasoner"})

TEMP_DIR = os.path.join(tempfile.gettempdir(), "Zenith")
RESEARCH_DIR = os.path.join(TEMP_DIR, "Research")
EXPORTS_DIR = os.path.join(RESEARCH_DIR, "exports")
EXPERIMENTS_DIR = os.path.join(RESEARCH_DIR, "experiments")
PAPERS_DIR = os.path.join(RESEARCH_DIR, "papers")

for _d in [RESEARCH_DIR, EXPORTS_DIR, EXPERIMENTS_DIR, PAPERS_DIR]:
    os.makedirs(_d, exist_ok=True)


# ══════════════════════════════════════════════════════════════════════════════
# ██  LLM CALL HELPERS (mirrors _call_llm from process_files.py)
# ══════════════════════════════════════════════════════════════════════════════

def _llm_chat(provider, api_key, model, messages, temperature=0.7, max_tokens=4096):
    """Multi-turn LLM chat with retry logic (follows AutoResearchClaw patterns).
    messages = [{role, content}, ...].
    Returns {text, usage: {input_tokens, output_tokens}}."""

    def _build_request():
        """Build the urllib request for the given provider."""
        if provider == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            mdl = model or "gpt-5.4-nano"
            body = {"model": mdl, "messages": messages, "max_tokens": max_tokens}
            # Reasoning models reject temperature param (ARC pattern)
            if not any(mdl.startswith(p) for p in _NO_TEMPERATURE_MODELS):
                body["temperature"] = temperature
            payload = json.dumps(body).encode()
            return urllib.request.Request(url, data=payload, headers={
                "Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                "User-Agent": _USER_AGENT}), mdl

        elif provider == "anthropic":
            url = "https://api.anthropic.com/v1/messages"
            mdl = model or "claude-sonnet-4-5-20260115"
            sys_msgs = [m for m in messages if m["role"] == "system"]
            non_sys = [m for m in messages if m["role"] != "system"]
            body = {"model": mdl, "max_tokens": max_tokens, "messages": non_sys,
                    "temperature": temperature}
            if sys_msgs:
                body["system"] = sys_msgs[0]["content"]
            payload = json.dumps(body).encode()
            return urllib.request.Request(url, data=payload, headers={
                "x-api-key": api_key, "Content-Type": "application/json",
                "anthropic-version": "2023-06-01", "User-Agent": _USER_AGENT}), mdl

        elif provider == "google":
            mdl = model or "gemini-3-flash-preview"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{mdl}:generateContent?key={api_key}"
            contents = []
            for m in messages:
                if m["role"] == "system":
                    contents.append({"role": "user", "parts": [{"text": m["content"]}]})
                    contents.append({"role": "model", "parts": [{"text": "Understood."}]})
                elif m["role"] == "assistant":
                    contents.append({"role": "model", "parts": [{"text": m["content"]}]})
                else:
                    contents.append({"role": "user", "parts": [{"text": m["content"]}]})
            payload = json.dumps({"contents": contents,
                                  "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}}).encode()
            return urllib.request.Request(url, data=payload, headers={
                "Content-Type": "application/json", "User-Agent": _USER_AGENT}), mdl

        elif provider == "deepseek":
            url = "https://api.deepseek.com/chat/completions"
            mdl = model or "deepseek-chat"
            payload = json.dumps({"model": mdl, "messages": messages,
                                  "max_tokens": max_tokens, "temperature": temperature}).encode()
            return urllib.request.Request(url, data=payload, headers={
                "Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                "User-Agent": _USER_AGENT}), mdl

        elif provider == "groq":
            url = "https://api.groq.com/openai/v1/chat/completions"
            mdl = model or "llama-3.3-70b-versatile"
            payload = json.dumps({"model": mdl, "messages": messages,
                                  "max_tokens": max_tokens, "temperature": temperature}).encode()
            return urllib.request.Request(url, data=payload, headers={
                "Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                "User-Agent": _USER_AGENT}), mdl

        else:
            return None, model or ""

    req, mdl = _build_request()
    if req is None:
        return {"error": f"Unknown provider: {provider}"}

    # ── Retry loop with exponential backoff + jitter (ARC pattern) ──
    last_error = None
    for attempt in range(_MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read().decode())

            text = ""
            usage = {"input_tokens": 0, "output_tokens": 0}

            if provider in ("openai", "groq", "deepseek"):
                text = data["choices"][0]["message"]["content"]
                u = data.get("usage", {})
                usage = {"input_tokens": u.get("prompt_tokens", 0),
                         "output_tokens": u.get("completion_tokens", 0)}
            elif provider == "anthropic":
                text = data["content"][0]["text"]
                u = data.get("usage", {})
                usage = {"input_tokens": u.get("input_tokens", 0),
                         "output_tokens": u.get("output_tokens", 0)}
            elif provider == "google":
                cands = data.get("candidates", [])
                if cands and cands[0].get("content", {}).get("parts"):
                    text = cands[0]["content"]["parts"][0]["text"]
                else:
                    # Google may return empty candidates with a promptFeedback error
                    feedback = data.get("promptFeedback", {})
                    block_reason = feedback.get("blockReason", "")
                    if block_reason:
                        return {"error": f"Google blocked request: {block_reason}"}
                    return {"error": "Google returned empty response. Try a different query."}
                u = data.get("usageMetadata", {})
                usage = {"input_tokens": u.get("promptTokenCount", 0),
                         "output_tokens": u.get("candidatesTokenCount", 0)}

            return {"text": text, "usage": usage}

        except urllib.error.HTTPError as e:
            status = e.code
            body = ""
            try:
                body = e.read().decode()[:500]
            except Exception:
                pass
            last_error = f"API error {status}: {body[:300]}"

            # Non-retryable errors — fail immediately
            if status in (400, 401, 403, 404):
                # 400 can be transient on some providers (Azure overload)
                if status == 400 and any(kw in body.lower() for kw in ("rate limit", "overloaded", "temporarily", "capacity", "throttl", "retry")):
                    pass  # fall through to retry
                else:
                    return {"error": last_error}

            # Retryable: 429, 500, 502, 503, 504, 529
            if status in _RETRYABLE_CODES or (status == 400 and "rate" in body.lower()):
                delay = min(_RETRY_BASE_DELAY * (2 ** attempt), _MAX_BACKOFF_SEC)
                delay += random.uniform(0, delay * 0.3)  # jitter
                time.sleep(delay)
                # Rebuild request (some providers need fresh state)
                req, mdl = _build_request()
                if req is None:
                    return {"error": f"Unknown provider: {provider}"}
                continue

            return {"error": last_error}

        except (urllib.error.URLError, OSError) as e:
            last_error = f"Connection error: {e}"
            if attempt < _MAX_RETRIES - 1:
                delay = min(_RETRY_BASE_DELAY * (2 ** attempt), _MAX_BACKOFF_SEC)
                time.sleep(delay)
                req, mdl = _build_request()
                if req is None:
                    return {"error": f"Unknown provider: {provider}"}
                continue
            return {"error": last_error}

        except Exception as e:
            return {"error": str(e)}

    return {"error": f"All {_MAX_RETRIES} retries failed. Last: {last_error}"}


# ══════════════════════════════════════════════════════════════════════════════
# ██  TOOL IMPLEMENTATIONS
# ══════════════════════════════════════════════════════════════════════════════

def _search_arxiv(query, max_results=5):
    """Search arXiv via its Atom API."""
    try:
        q = urllib.parse.quote(query)
        url = f"http://export.arxiv.org/api/query?search_query=all:{q}&start=0&max_results={max_results}&sortBy=relevance"
        req = urllib.request.Request(url, headers={"User-Agent": "Zenith/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
        import xml.etree.ElementTree as ET
        root = ET.fromstring(raw)
        ns = {"a": "http://www.w3.org/2005/Atom"}
        papers = []
        for entry in root.findall("a:entry", ns):
            title = (entry.findtext("a:title", "", ns) or "").strip().replace("\n", " ")
            summary = (entry.findtext("a:summary", "", ns) or "").strip().replace("\n", " ")
            authors = [a.findtext("a:name", "", ns) for a in entry.findall("a:author", ns)]
            published = entry.findtext("a:published", "", ns)[:4] if entry.findtext("a:published", "", ns) else ""
            arxiv_id = (entry.findtext("a:id", "", ns) or "").split("/abs/")[-1]
            link = entry.findtext("a:id", "", ns) or ""
            papers.append({
                "title": title, "authors": authors, "year": published,
                "abstract": summary[:500], "doi": "", "citations": 0,
                "url": link, "source": "arXiv", "arxiv_id": arxiv_id,
            })
        return papers
    except Exception as e:
        return []


def _search_semantic_scholar(query, max_results=5, year_min=None):
    """Search Semantic Scholar API with retry (ARC pattern)."""
    try:
        q = urllib.parse.quote(query)
        url = f"https://api.semanticscholar.org/graph/v1/paper/search?query={q}&limit={max_results}&fields=title,authors,year,abstract,citationCount,externalIds,url"
        if year_min:
            url += f"&year={year_min}-"

        data = None
        for attempt in range(_MAX_RETRIES):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": _USER_AGENT, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode())
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    delay = min(2 ** (attempt + 1), 30)
                    time.sleep(delay + random.uniform(0, delay * 0.3))
                    continue
                return []
            except (urllib.error.URLError, OSError):
                if attempt < _MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)
                    continue
                return []

        if data is None:
            return []

        papers = []
        for p in data.get("data", []):
            authors = [a.get("name", "") for a in (p.get("authors") or [])]
            doi = (p.get("externalIds") or {}).get("DOI", "")
            papers.append({
                "title": p.get("title", ""), "authors": authors,
                "year": p.get("year", ""), "abstract": (p.get("abstract") or "")[:500],
                "doi": doi, "citations": p.get("citationCount", 0),
                "url": p.get("url", ""), "source": "Semantic Scholar",
            })
        return papers
    except Exception:
        return []


def _search_openalex(query, max_results=5):
    """Search OpenAlex API."""
    try:
        import urllib.parse
        q = urllib.parse.quote(query)
        url = f"https://api.openalex.org/works?search={q}&per_page={max_results}&sort=relevance_score:desc&select=title,authorships,publication_year,doi,cited_by_count,id"
        req = urllib.request.Request(url, headers={"User-Agent": "mailto:zenith@example.com"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        papers = []
        for w in data.get("results", []):
            authors = [a.get("author", {}).get("display_name", "") for a in (w.get("authorships") or [])]
            doi = (w.get("doi") or "").replace("https://doi.org/", "")
            papers.append({
                "title": w.get("title", ""), "authors": authors,
                "year": w.get("publication_year", ""), "abstract": "",
                "doi": doi, "citations": w.get("cited_by_count", 0),
                "url": w.get("id", ""), "source": "OpenAlex",
            })
        return papers
    except Exception:
        return []


def _web_search_brave(query, api_key, max_results=10):
    """Web search via Brave Search API (https://brave.com/search/api/)."""
    try:
        encoded = urllib.parse.quote_plus(query)
        url = f"https://api.search.brave.com/res/v1/web/search?q={encoded}&count={max_results}"
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": api_key,
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            # Handle gzip
            if resp.headers.get("Content-Encoding") == "gzip":
                import gzip
                raw = gzip.decompress(raw)
            data = json.loads(raw.decode("utf-8"))
        results = []
        for r in data.get("web", {}).get("results", []):
            results.append({
                "title": r.get("title", ""), "url": r.get("url", ""),
                "snippet": r.get("description", "")[:400], "score": 0,
                "source": "brave",
            })
        # Brave may include an infobox / summary
        answer = ""
        if data.get("summarizer", {}).get("key"):
            answer = data["summarizer"].get("summary", "")
        return {"results": results, "answer": answer}
    except Exception as e:
        return {"results": [], "answer": "", "error": str(e)}


def _firecrawl_scrape(url_to_scrape, api_key):
    """Scrape a URL via Firecrawl API (https://firecrawl.dev) → returns markdown text."""
    try:
        payload = json.dumps({
            "url": url_to_scrape,
            "formats": ["markdown"],
            "onlyMainContent": True,
            "timeout": 30000,
        }).encode()
        req = urllib.request.Request(
            "https://api.firecrawl.dev/v1/scrape",
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        )
        with urllib.request.urlopen(req, timeout=40) as resp:
            data = json.loads(resp.read().decode())
        if data.get("success"):
            md = data.get("data", {}).get("markdown", "")
            title = data.get("data", {}).get("metadata", {}).get("title", "")
            return {"ok": True, "markdown": md[:8000], "title": title, "url": url_to_scrape}
        return {"ok": False, "error": data.get("error", "Unknown error")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _firecrawl_search(query, api_key, max_results=5):
    """Search via Firecrawl Search API → returns URLs + scraped content."""
    try:
        payload = json.dumps({
            "query": query,
            "limit": max_results,
            "scrapeOptions": {"formats": ["markdown"], "onlyMainContent": True},
        }).encode()
        req = urllib.request.Request(
            "https://api.firecrawl.dev/v1/search",
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode())
        results = []
        if data.get("success"):
            for r in data.get("data", []):
                results.append({
                    "title": r.get("metadata", {}).get("title", r.get("url", "")),
                    "url": r.get("url", ""),
                    "snippet": r.get("markdown", "")[:500],
                    "score": 0,
                    "source": "firecrawl",
                })
        return {"results": results}
    except Exception as e:
        return {"results": [], "error": str(e)}


def _web_search_tavily(query, api_key, max_results=5):
    """Web search via Tavily AI."""
    try:
        url = "https://api.tavily.com/search"
        payload = json.dumps({
            "api_key": api_key, "query": query, "max_results": max_results,
            "search_depth": "advanced", "include_answer": True,
        }).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        results = []
        for r in data.get("results", []):
            results.append({
                "title": r.get("title", ""), "url": r.get("url", ""),
                "snippet": r.get("content", "")[:300], "score": r.get("score", 0),
                "source": "tavily",
            })
        return {"results": results, "answer": data.get("answer", "")}
    except Exception as e:
        return {"results": [], "answer": "", "error": str(e)}


def _web_search_duckduckgo(query, max_results=5):
    """Fallback web search via DuckDuckGo HTML (no API key needed).
    Uses ARC's pattern: separate regex for links/snippets + URL unwrapping."""
    try:
        encoded = urllib.parse.quote_plus(query)
        url = f"https://html.duckduckgo.com/html/?q={encoded}"
        req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")

        # Separate regex patterns (more robust, matches ARC)
        link_pattern = re.compile(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', re.DOTALL)
        snippet_pattern = re.compile(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', re.DOTALL)
        links = link_pattern.findall(html)
        snippets = snippet_pattern.findall(html)

        results = []
        for i, (raw_url, title_html) in enumerate(links[:max_results]):
            title = re.sub(r'<[^>]+>', '', title_html).strip()
            snippet = re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ""
            # Unwrap DDG redirect URLs (ARC pattern)
            result_url = raw_url
            if "duckduckgo.com" in raw_url:
                parsed = urllib.parse.urlparse(raw_url)
                uddg = urllib.parse.parse_qs(parsed.query).get("uddg")
                if uddg:
                    result_url = urllib.parse.unquote(uddg[0])
                else:
                    continue
            results.append({"title": title, "url": result_url, "snippet": snippet[:300]})
        return {"results": results}
    except Exception:
        return {"results": []}


# ══════════════════════════════════════════════════════════════════════════════
# ██  PUBLIC ACTIONS (registered in process_files.py ACTIONS dict)
# ══════════════════════════════════════════════════════════════════════════════

def research_chat(args):
    """Multi-turn research chat with optional tool dispatch.
    Args: {messages, api_key, provider, model, temperature, max_tokens,
           system_prompt, enabled_tools}
    Returns: {reply, tokens, type, data, tool_used, tool_results}
    """
    messages_in = args.get("messages", [])
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")
    temperature = args.get("temperature", 0.7)
    max_tokens = args.get("max_tokens", 4096)
    system_prompt = args.get("system_prompt", "")
    enabled_tools = args.get("enabled_tools", [])
    tavily_api_key = args.get("tavily_api_key", "")
    brave_api_key = args.get("brave_api_key", "")
    firecrawl_api_key = args.get("firecrawl_api_key", "")

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}
    if not messages_in:
        return {"error": "No messages provided."}

    # Build tool descriptions for the system prompt
    tool_desc = ""
    if enabled_tools:
        tools = []
        if "literature" in enabled_tools:
            tools.append("- LITERATURE_SEARCH: Search academic papers on arXiv, Semantic Scholar, and OpenAlex")
        if "web_search" in enabled_tools:
            tools.append("- WEB_SEARCH: Search the web for information (uses Brave, Tavily, Firecrawl, DuckDuckGo — aggregated & deduplicated)")
        if "pdf_extract" in enabled_tools:
            tools.append("- PDF_EXTRACT: Extract text from PDF files")
        if "novelty" in enabled_tools:
            tools.append("- NOVELTY_CHECK: Assess how novel a research idea is")
        if "citation_verify" in enabled_tools:
            tools.append("- CITATION_VERIFY: Verify if citations/references are accurate")
        if "experiment" in enabled_tools:
            tools.append("- EXPERIMENT: Run Python code in a sandboxed environment")
        if tools:
            tool_desc = (
                "\n\nYou have access to these research tools:\n" +
                "\n".join(tools) +
                "\n\nWhen you need to use a tool, include a tool call tag in your response like: "
                "[TOOL:TOOL_NAME]{\"param\": \"value\"}[/TOOL]\n"
                "For LITERATURE_SEARCH: {\"query\": \"...\", \"max_results\": 5}\n"
                "For WEB_SEARCH: {\"query\": \"...\"}\n"
                "For PDF_EXTRACT: {\"path\": \"...\"}\n"
                "For NOVELTY_CHECK: {\"idea\": \"...\"}\n"
                "For CITATION_VERIFY: {\"citations\": [\"title1\", \"title2\"]}\n"
                "For EXPERIMENT: {\"code\": \"print('hello')\", \"timeout_sec\": 30}\n"
                "Always explain what you found after using a tool."
            )

    full_system = system_prompt + tool_desc

    # Build messages for LLM
    chat_msgs = []
    if full_system:
        chat_msgs.append({"role": "system", "content": full_system})
    for m in messages_in:
        chat_msgs.append({"role": m.get("role", "user"), "content": m.get("content", "")})

    # First LLM call
    result = _llm_chat(provider, api_key, model, chat_msgs, temperature, max_tokens)
    if "error" in result:
        return result

    reply_text = result["text"]
    usage = result.get("usage", {})
    tool_results = []

    # Check for tool calls in the response
    tool_pattern = r'\[TOOL:(\w+)\](.*?)\[/TOOL\]'
    tool_matches = re.findall(tool_pattern, reply_text, re.DOTALL)

    if tool_matches:
        for tool_name, tool_args_str in tool_matches:
            try:
                tool_args = json.loads(tool_args_str.strip())
            except json.JSONDecodeError:
                tool_args = {"query": tool_args_str.strip()}

            tool_result = _execute_tool(tool_name, tool_args, api_key, provider, model, tavily_api_key, brave_api_key, firecrawl_api_key)
            tool_results.append(tool_result)

        # If we got tool results, do a follow-up LLM call to synthesize
        if tool_results:
            tool_context = "\n\n".join([
                f"[Tool: {tr['tool_name']}]\n{tr.get('summary', json.dumps(tr.get('data', {}), indent=2)[:2000])}"
                for tr in tool_results
            ])

            # Clean tool tags from original reply
            clean_reply = re.sub(tool_pattern, '', reply_text).strip()

            followup_msgs = chat_msgs + [
                {"role": "assistant", "content": clean_reply},
                {"role": "user", "content": f"Here are the tool results:\n{tool_context}\n\nPlease synthesize these results into a clear, comprehensive response."}
            ]

            followup = _llm_chat(provider, api_key, model, followup_msgs, temperature, max_tokens)
            if "error" not in followup:
                reply_text = followup["text"]
                fu = followup.get("usage", {})
                usage["input_tokens"] = usage.get("input_tokens", 0) + fu.get("input_tokens", 0)
                usage["output_tokens"] = usage.get("output_tokens", 0) + fu.get("output_tokens", 0)

    # Determine response type
    resp_type = "text"
    resp_data = None
    if tool_results:
        for tr in tool_results:
            if tr.get("type") == "papers" and tr.get("data"):
                resp_type = "papers"
                resp_data = tr["data"]
                break

    return {
        "reply": reply_text,
        "tokens": {"input": usage.get("input_tokens", 0), "output": usage.get("output_tokens", 0)},
        "type": resp_type,
        "data": resp_data,
        "tool_results": tool_results if tool_results else None,
    }


def _execute_tool(tool_name, tool_args, api_key, provider, model, tavily_api_key="", brave_api_key="", firecrawl_api_key=""):
    """Dispatch a tool call and return structured result."""
    tool_name = tool_name.upper().strip()

    if tool_name == "LITERATURE_SEARCH":
        query = tool_args.get("query", "")
        max_results = tool_args.get("max_results", 5)
        year_min = tool_args.get("year_min", None)

        # Source order matches ARC: OpenAlex (10K/day) → S2 (1K/5min) → arXiv (1/3s)
        all_papers = []
        all_papers.extend(_search_openalex(query, max_results))
        time.sleep(0.5)
        all_papers.extend(_search_semantic_scholar(query, max_results, year_min))
        time.sleep(1.0)
        all_papers.extend(_search_arxiv(query, max_results))

        # Deduplicate by title similarity
        seen = set()
        unique = []
        for p in all_papers:
            key = p["title"].lower().strip()[:80]
            if key not in seen:
                seen.add(key)
                unique.append(p)

        # Sort by citations desc
        unique.sort(key=lambda x: x.get("citations", 0), reverse=True)
        unique = unique[:max_results * 2]  # keep top results

        summary = f"Found {len(unique)} papers for '{query}'."
        if unique:
            top3 = unique[:3]
            summary += " Top results: " + "; ".join([f"\"{p['title']}\" ({p.get('year','?')}, {p.get('citations',0)} cites)" for p in top3])

        return {"tool_name": "LITERATURE_SEARCH", "type": "papers", "data": unique, "summary": summary}

    elif tool_name == "WEB_SEARCH":
        query = tool_args.get("query", "")
        max_res = tool_args.get("max_results", 8)
        # ── Aggregate results from all available search providers ──
        all_results = []
        answer = ""
        sources_used = []

        # 1. Brave Search (highest quality, if key available)
        brave_key = brave_api_key or tool_args.get("brave_api_key", "")
        if brave_key:
            br = _web_search_brave(query, brave_key, max_res)
            if br.get("results"):
                all_results.extend(br["results"])
                sources_used.append("Brave")
            if br.get("answer"):
                answer = br["answer"]

        # 2. Tavily (AI-powered, if key available)
        tavily_key = tavily_api_key or tool_args.get("tavily_api_key", "")
        if tavily_key:
            tv = _web_search_tavily(query, tavily_key, max_res)
            if tv.get("results"):
                all_results.extend(tv["results"])
                sources_used.append("Tavily")
            if tv.get("answer") and not answer:
                answer = tv["answer"]

        # 3. Firecrawl Search (deep content, if key available)
        fc_key = firecrawl_api_key or tool_args.get("firecrawl_api_key", "")
        if fc_key:
            fc = _firecrawl_search(query, fc_key, min(max_res, 5))
            if fc.get("results"):
                all_results.extend(fc["results"])
                sources_used.append("Firecrawl")

        # 4. DuckDuckGo fallback (always available, no key needed)
        ddg = _web_search_duckduckgo(query, max_res)
        if ddg.get("results"):
            for r in ddg["results"]:
                r["source"] = "duckduckgo"
            all_results.extend(ddg["results"])
            if not sources_used:
                sources_used.append("DuckDuckGo")

        # ── Smart deduplication by domain+path ──
        seen_urls = set()
        unique = []
        for r in all_results:
            url = r.get("url", "")
            # Normalize URL for dedup: strip protocol, trailing slash, query params
            norm = re.sub(r'^https?://(www\.)?', '', url).rstrip('/').split('?')[0].split('#')[0].lower()
            if norm and norm not in seen_urls:
                seen_urls.add(norm)
                unique.append(r)
        # Also dedup by title similarity
        seen_titles = set()
        deduped = []
        for r in unique:
            title_key = re.sub(r'[^a-z0-9]+', ' ', r.get("title", "").lower()).strip()[:60]
            if title_key and title_key not in seen_titles:
                seen_titles.add(title_key)
                deduped.append(r)
            elif not title_key:
                deduped.append(r)

        results = deduped[:max_res * 2]
        src_str = " + ".join(sources_used) if sources_used else "DuckDuckGo"
        summary = f"Found {len(results)} web results for '{query}' via {src_str}."
        if results:
            summary += " Top: " + "; ".join([f"{r['title']}" for r in results[:3]])
        if answer:
            summary = answer + "\n\n" + summary
        return {"tool_name": "WEB_SEARCH", "type": "text", "data": results, "summary": summary}

    elif tool_name == "NOVELTY_CHECK":
        idea = tool_args.get("idea", "")
        # ARC pattern: keyword extraction + Jaccard similarity + multi-source search
        _STOP = frozenset({"a","an","the","and","or","but","in","on","of","for","to","with","by","at","from","as","is","are","was","were","be","been","have","has","had","do","does","did","will","would","could","should","may","might","not","using","based","via","new","novel","approach","method","study","research","paper","proposed","results"})
        idea_keywords = [t for t in re.findall(r'[a-zA-Z][a-zA-Z0-9_-]+', idea.lower()) if t not in _STOP and len(t) >= 3]
        idea_kw_set = set(idea_keywords)

        # Search multiple sources (ARC: multi-query)
        all_papers = []
        all_papers.extend(_search_openalex(idea, 10))
        time.sleep(0.5)
        all_papers.extend(_search_semantic_scholar(idea, 10))
        time.sleep(0.5)
        # Build keyword query from top keywords
        if len(idea_keywords) >= 3:
            kw_query = " ".join(idea_keywords[:5])
            all_papers.extend(_search_semantic_scholar(kw_query, 5))

        # Deduplicate
        seen = set()
        unique = []
        for p in all_papers:
            key = p["title"].lower().strip()[:80]
            if key not in seen:
                seen.add(key)
                unique.append(p)

        # Compute similarity scores (ARC Jaccard pattern)
        similar = []
        for p in unique:
            p_kw = set(re.findall(r'[a-zA-Z][a-zA-Z0-9_-]+', (p.get("title","") + " " + p.get("abstract","")).lower())) - _STOP
            if not p_kw or not idea_kw_set:
                sim = 0.0
            else:
                sim = len(idea_kw_set & p_kw) / max(len(idea_kw_set | p_kw), 1)
            if sim >= 0.15:  # ARC threshold
                similar.append({**p, "similarity": round(sim, 3)})
        similar.sort(key=lambda x: x["similarity"], reverse=True)
        similar = similar[:15]

        # Compute novelty score (ARC pattern)
        if not similar:
            novelty_score, assessment = 1.0, "high"
        else:
            top = similar[:5]
            max_sim = max(p["similarity"] for p in top)
            high_cite = sum(1 for p in top if p["similarity"] >= 0.3 and p.get("citations", 0) >= 50)
            raw = 1.0 - max_sim
            if high_cite >= 2:
                raw *= 0.7
            novelty_score = round(max(0.0, min(1.0, raw)), 3)
            if novelty_score >= 0.7: assessment = "high"
            elif novelty_score >= 0.45: assessment = "moderate"
            elif novelty_score >= 0.25: assessment = "low"
            else: assessment = "critical"

        recommendation = "proceed" if assessment == "high" else ("differentiate" if assessment in ("moderate","low") else "abort")
        summary = f"Novelty score: {novelty_score} ({assessment}) — Recommendation: {recommendation}\n"
        summary += f"Found {len(similar)} potentially overlapping papers (of {len(unique)} searched).\n"
        for p in similar[:5]:
            summary += f"  - \"{p['title']}\" ({p.get('year','?')}, sim={p['similarity']}, {p.get('citations',0)} cites)\n"

        return {"tool_name": "NOVELTY_CHECK", "type": "text",
                "data": {"novelty_score": novelty_score, "assessment": assessment, "recommendation": recommendation, "similar_papers": similar[:10]},
                "summary": summary}

    elif tool_name == "CITATION_VERIFY":
        citations = tool_args.get("citations", [])
        if isinstance(citations, str):
            citations = [c.strip() for c in citations.split(";") if c.strip()]
        # Use the full 3-layer verification system
        vr = verify_citations({"citations": citations})
        if "error" in vr:
            return {"tool_name": "CITATION_VERIFY", "type": "text", "data": None, "summary": vr["error"]}
        s = vr.get("summary", {})
        summary = (f"Citation verification: {s.get('verified',0)} verified, {s.get('suspicious',0)} suspicious, "
                   f"{s.get('hallucinated',0)} hallucinated (integrity: {s.get('integrity_score',0):.0%})")
        return {"tool_name": "CITATION_VERIFY", "type": "text", "data": vr.get("results", []), "summary": summary}

    elif tool_name == "PDF_EXTRACT":
        path = tool_args.get("path", "")
        if not path:
            return {"tool_name": "PDF_EXTRACT", "type": "text", "data": None, "summary": "No PDF path provided."}
        pdf_result = extract_pdf_text({"path": path})
        if "error" in pdf_result:
            return {"tool_name": "PDF_EXTRACT", "type": "text", "data": None, "summary": pdf_result["error"]}
        text = pdf_result.get("text", "")[:3000]
        summary = f"Extracted {pdf_result.get('pages', 0)} pages ({len(text)} chars) from PDF."
        return {"tool_name": "PDF_EXTRACT", "type": "text", "data": {"text": text, "pages": pdf_result.get("pages", 0)}, "summary": summary}

    elif tool_name == "EXPERIMENT":
        code = tool_args.get("code", "")
        if not code:
            return {"tool_name": "EXPERIMENT", "type": "code", "data": None, "summary": "No code provided."}
        exp_result = run_experiment_action({"code": code, "timeout_sec": tool_args.get("timeout_sec", 30)})
        if exp_result.get("ok"):
            summary = f"Experiment completed (exit code {exp_result.get('exit_code', -1)}).\nstdout: {exp_result.get('stdout', '')[:500]}"
            if exp_result.get("stderr"):
                summary += f"\nstderr: {exp_result['stderr'][:300]}"
        else:
            summary = f"Experiment failed: {exp_result.get('stderr', exp_result.get('error', 'Unknown error'))}"
        return {"tool_name": "EXPERIMENT", "type": "code", "data": exp_result, "summary": summary}

    else:
        return {"tool_name": tool_name, "type": "text", "data": None, "summary": f"Unknown tool: {tool_name}"}


def search_papers(args):
    """Search academic papers across multiple sources.
    Args: {query, max_results, sources, year_min}
    Returns: {ok, papers: [...]}
    """
    query = args.get("query", "")
    max_results = args.get("max_results", 10)
    sources = args.get("sources", ["arxiv", "semantic_scholar", "openalex"])
    year_min = args.get("year_min", None)

    if not query:
        return {"error": "Query is required."}

    # Source order matches ARC: OpenAlex (10K/day) → S2 (1K/5min) → arXiv (1/3s)
    all_papers = []
    if "openalex" in sources:
        all_papers.extend(_search_openalex(query, max_results))
        time.sleep(0.5)
    if "semantic_scholar" in sources:
        all_papers.extend(_search_semantic_scholar(query, max_results, year_min))
        time.sleep(1.0)
    if "arxiv" in sources:
        all_papers.extend(_search_arxiv(query, max_results))

    # Deduplicate
    seen = set()
    unique = []
    for p in all_papers:
        key = p["title"].lower().strip()[:80]
        if key not in seen:
            seen.add(key)
            unique.append(p)

    unique.sort(key=lambda x: x.get("citations", 0), reverse=True)
    return {"ok": True, "papers": unique[:max_results * 2], "total": len(unique)}


def web_search_action(args):
    """Web search action.
    Args: {query, max_results}
    Returns: {ok, results: [...]}
    """
    query = args.get("query", "")
    max_results = args.get("max_results", 5)

    if not query:
        return {"error": "Query is required."}

    result = _web_search_duckduckgo(query, max_results)
    return {"ok": True, "results": result.get("results", [])}


def extract_pdf_text(args):
    """Extract text from a PDF file.
    Args: {path}
    Returns: {ok, text, pages, metadata}
    """
    path = args.get("path", "")
    if not path or not os.path.isfile(path):
        return {"error": f"File not found: {path}"}

    text = ""
    pages = 0
    metadata = {}

    try:
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            pages = len(pdf.pages)
            metadata = pdf.metadata or {}
            text_parts = []
            for page in pdf.pages[:50]:  # limit to 50 pages
                t = page.extract_text() or ""
                text_parts.append(t)
            text = "\n\n".join(text_parts)
    except ImportError:
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(path)
            pages = len(reader.pages)
            metadata = dict(reader.metadata) if reader.metadata else {}
            text_parts = []
            for page in reader.pages[:50]:
                t = page.extract_text() or ""
                text_parts.append(t)
            text = "\n\n".join(text_parts)
        except ImportError:
            return {"error": "PDF extraction requires pdfplumber or PyPDF2. Install via: pip install pdfplumber"}
        except Exception as e:
            return {"error": f"PDF read error: {e}"}
    except Exception as e:
        return {"error": f"PDF read error: {e}"}

    # Sanitize metadata for JSON
    safe_meta = {}
    for k, v in metadata.items():
        try:
            json.dumps(v)
            safe_meta[k] = v
        except (TypeError, ValueError):
            safe_meta[k] = str(v)

    return {"ok": True, "text": text[:100000], "pages": pages, "metadata": safe_meta}


def check_novelty(args):
    """Assess novelty of a research idea.
    Args: {idea, papers (optional), api_key, provider, model}
    Returns: {ok, score, assessment, similar_papers, gaps}
    """
    idea = args.get("idea", "")
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")

    if not idea:
        return {"error": "Research idea is required."}
    if not api_key:
        return {"error": "API key required."}

    # Search for related papers
    related = _search_semantic_scholar(idea, 10)
    related.extend(_search_arxiv(idea, 5))

    # Deduplicate
    seen = set()
    unique = []
    for p in related:
        key = p["title"].lower().strip()[:80]
        if key not in seen:
            seen.add(key)
            unique.append(p)
    unique.sort(key=lambda x: x.get("citations", 0), reverse=True)
    top_papers = unique[:10]

    # Ask LLM to assess novelty
    papers_context = "\n".join([
        f"- \"{p['title']}\" ({p.get('year','?')}, {p.get('citations',0)} citations)"
        for p in top_papers
    ])

    prompt = (
        f"Research idea: {idea}\n\n"
        f"Related existing papers:\n{papers_context}\n\n"
        "Assess the novelty of this research idea on a scale of 1-10. Provide:\n"
        "1. Novelty score (1-10)\n"
        "2. Brief assessment of what's novel vs what exists\n"
        "3. Identified gaps this idea could fill\n"
        "4. Suggestions to increase novelty\n"
        "Format as JSON: {\"score\": N, \"assessment\": \"...\", \"gaps\": [\"...\"], \"suggestions\": [\"...\"]}"
    )

    result = _llm_chat(provider, api_key, model,
                       [{"role": "system", "content": "You are a research novelty assessor. Be honest and constructive."},
                        {"role": "user", "content": prompt}],
                       temperature=0.3, max_tokens=2048)

    if "error" in result:
        return result

    # Try to parse JSON from response
    text = result["text"]
    try:
        # Extract JSON from response
        json_match = re.search(r'\{[^{}]*"score"[^{}]*\}', text, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group())
            return {
                "ok": True,
                "score": parsed.get("score", 5),
                "assessment": parsed.get("assessment", text),
                "gaps": parsed.get("gaps", []),
                "suggestions": parsed.get("suggestions", []),
                "similar_papers": top_papers[:5],
                "tokens": result.get("usage"),
            }
    except (json.JSONDecodeError, AttributeError):
        pass

    return {
        "ok": True, "score": 5, "assessment": text,
        "gaps": [], "suggestions": [],
        "similar_papers": top_papers[:5],
        "tokens": result.get("usage"),
    }


# ── Title similarity (mirrors ARC verify.py) ──────────────────────────────

def _title_similarity(a, b):
    """Word-overlap Jaccard-ish similarity between two titles (0.0-1.0)."""
    def _words(t):
        return set(re.sub(r'[^a-z0-9\s]', '', t.lower()).split()) - {''}
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / max(len(wa), len(wb))


def _verify_by_doi(doi, expected_title):
    """L2: Verify DOI via CrossRef API, with DataCite fallback for arXiv DOIs (ARC pattern)."""
    encoded_doi = urllib.parse.quote(doi, safe='')
    url = f"https://api.crossref.org/works/{encoded_doi}"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Zenith/1.0 (mailto:zenith@example.com)", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode())
        titles = body.get("message", {}).get("title", [])
        found_title = titles[0] if titles else ""
        if not found_title:
            return {"status": "verified", "confidence": 0.85, "method": "doi", "details": f"DOI {doi} resolves via CrossRef"}
        sim = _title_similarity(expected_title, found_title)
        if sim >= 0.80:
            return {"status": "verified", "confidence": sim, "method": "doi", "details": f"Confirmed via CrossRef: '{found_title}'"}
        elif sim >= 0.50:
            return {"status": "suspicious", "confidence": sim, "method": "doi", "details": f"DOI resolves but title differs (sim={sim:.2f})"}
        else:
            return {"status": "suspicious", "confidence": sim, "method": "doi", "details": f"DOI resolves but title mismatch (sim={sim:.2f})"}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            # Try DataCite for arXiv DOIs
            if doi.startswith("10.48550/") or doi.startswith("10.5281/"):
                return _verify_by_datacite(doi, expected_title)
            return {"status": "hallucinated", "confidence": 0.9, "method": "doi", "details": f"DOI {doi} not found (HTTP 404)"}
        return None
    except Exception:
        return None


def _verify_by_datacite(doi, expected_title):
    """DataCite fallback for arXiv/Zenodo DOIs (ARC pattern)."""
    try:
        encoded = urllib.parse.quote(doi, safe='')
        url = f"https://api.datacite.org/dois/{encoded}"
        req = urllib.request.Request(url, headers={"User-Agent": "Zenith/1.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode())
        dc_titles = body.get("data", {}).get("attributes", {}).get("titles", [])
        found_title = dc_titles[0].get("title", "") if dc_titles else ""
        if not found_title:
            return {"status": "verified", "confidence": 0.85, "method": "doi", "details": f"DOI {doi} resolves via DataCite"}
        sim = _title_similarity(expected_title, found_title)
        if sim >= 0.80:
            return {"status": "verified", "confidence": sim, "method": "doi", "details": f"Confirmed via DataCite: '{found_title}'"}
        return {"status": "suspicious", "confidence": sim, "method": "doi", "details": f"DataCite title differs (sim={sim:.2f})"}
    except Exception:
        return None


def _verify_by_openalex(title):
    """L3a: Verify via OpenAlex title search (10K+/day, ARC pattern)."""
    try:
        params = urllib.parse.urlencode({"filter": "title.search:" + title.replace(",", " ").replace(":", " "),
                                         "per_page": "5", "mailto": "zenith@example.com"})
        url = f"https://api.openalex.org/works?{params}"
        req = urllib.request.Request(url, headers={"User-Agent": "Zenith/1.0 (mailto:zenith@example.com)", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode())
        results = body.get("results", [])
        if not results:
            return {"status": "hallucinated", "confidence": 0.7, "method": "openalex", "details": "No results found via OpenAlex"}
        best_sim, best_title = 0.0, ""
        for r in results:
            ft = r.get("title", "")
            if ft:
                sim = _title_similarity(title, ft)
                if sim > best_sim:
                    best_sim, best_title = sim, ft
        if best_sim >= 0.80:
            return {"status": "verified", "confidence": best_sim, "method": "openalex", "details": f"Confirmed via OpenAlex: '{best_title}'"}
        elif best_sim >= 0.50:
            return {"status": "suspicious", "confidence": best_sim, "method": "openalex", "details": f"Partial match via OpenAlex (sim={best_sim:.2f})"}
        return {"status": "hallucinated", "confidence": 0.7, "method": "openalex", "details": "No close match found via OpenAlex"}
    except Exception:
        return None


def verify_citations(args):
    """Verify citations using ARC's 3-layer system: DOI/CrossRef → OpenAlex → S2+arXiv title search.
    Args: {citations: [str] or [{title, doi, arxiv_id}]}
    Returns: {ok, results: [{ref, status, confidence, method, details, doi, url}]}
    """
    citations = args.get("citations", [])
    if isinstance(citations, str):
        citations = [c.strip() for c in citations.split("\n") if c.strip()]

    if not citations:
        return {"error": "No citations to verify."}

    # Adaptive delays (ARC pattern)
    _DELAY_CROSSREF = 0.3
    _DELAY_OPENALEX = 0.2
    _DELAY_S2 = 1.5
    api_calls = 0
    _start = time.time()
    _TIMEOUT = 300  # 5 min global timeout (ARC BUG-22 fix)

    results = []
    for i, cite in enumerate(citations[:20]):
        # Global timeout check
        if time.time() - _start > _TIMEOUT:
            for remaining in citations[i:]:
                ref = remaining if isinstance(remaining, str) else remaining.get("title", str(remaining))
                results.append({"ref": ref, "status": "skipped", "confidence": 0, "method": "timeout", "details": "Verification timeout exceeded"})
            break

        # Normalize input
        if isinstance(cite, dict):
            title = cite.get("title", "")
            doi = cite.get("doi", "")
            arxiv_id = cite.get("arxiv_id", "")
            ref_str = title or str(cite)
        else:
            title = cite
            doi, arxiv_id = "", ""
            ref_str = cite

        if not title:
            results.append({"ref": ref_str, "status": "skipped", "confidence": 0, "method": "skipped", "details": "No title provided"})
            continue

        result = None

        # L2: DOI via CrossRef (fast, generous limits)
        if result is None and doi:
            if api_calls > 0:
                time.sleep(_DELAY_CROSSREF)
            result = _verify_by_doi(doi, title)
            api_calls += 1

        # L3a: OpenAlex title search (10K/day)
        if result is None:
            if api_calls > 0:
                time.sleep(_DELAY_OPENALEX)
            result = _verify_by_openalex(title)
            api_calls += 1

        # L3b: S2 title search (last resort)
        if result is None:
            if api_calls > 0:
                time.sleep(_DELAY_S2)
            found = _search_semantic_scholar(title, 3)
            api_calls += 1
            if found:
                best_sim, best = 0.0, None
                for p in found:
                    sim = _title_similarity(title, p.get("title", ""))
                    if sim > best_sim:
                        best_sim, best = sim, p
                if best_sim >= 0.80:
                    result = {"status": "verified", "confidence": best_sim, "method": "title_search",
                              "details": f"Found via S2: '{best['title']}'"}
                elif best_sim >= 0.50:
                    result = {"status": "suspicious", "confidence": best_sim, "method": "title_search",
                              "details": f"Partial match via S2 (sim={best_sim:.2f})"}
                else:
                    result = {"status": "hallucinated", "confidence": 1.0 - best_sim, "method": "title_search",
                              "details": "No close match found"}
            else:
                result = {"status": "hallucinated", "confidence": 0.7, "method": "title_search",
                          "details": "No results found via S2 + arXiv"}

        # Fallback: all layers failed
        if result is None:
            result = {"status": "skipped", "confidence": 0, "method": "skipped", "details": "All verification methods failed"}

        results.append({"ref": ref_str, "doi": doi, **result})

    verified = sum(1 for r in results if r["status"] == "verified")
    suspicious = sum(1 for r in results if r["status"] == "suspicious")
    hallucinated = sum(1 for r in results if r["status"] == "hallucinated")
    integrity = verified / max(1, len(results) - sum(1 for r in results if r["status"] == "skipped")) if results else 1.0

    return {
        "ok": True, "results": results,
        "summary": {"total": len(results), "verified": verified, "suspicious": suspicious,
                     "hallucinated": hallucinated, "integrity_score": round(integrity, 3)},
    }


def run_experiment_action(args):
    """Run Python code in a sandboxed subprocess.
    Args: {code, timeout_sec, packages}
    Returns: {ok, stdout, stderr, exit_code}
    """
    code = args.get("code", "")
    timeout = min(args.get("timeout_sec", 30), 60)  # max 60s

    if not code:
        return {"error": "No code provided."}

    # Write code to temp file
    import uuid
    exp_id = uuid.uuid4().hex[:8]
    exp_dir = os.path.join(EXPERIMENTS_DIR, f"exp_{exp_id}")
    os.makedirs(exp_dir, exist_ok=True)
    script_path = os.path.join(exp_dir, "run.py")

    with open(script_path, "w", encoding="utf-8") as f:
        f.write(code)

    try:
        import subprocess
        result = subprocess.run(
            [sys.executable, script_path],
            capture_output=True, text=True, timeout=timeout,
            cwd=exp_dir, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        )
        return {
            "ok": True, "stdout": result.stdout[:10000],
            "stderr": result.stderr[:5000], "exit_code": result.returncode,
            "experiment_dir": exp_dir,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "stdout": "", "stderr": f"Experiment timed out after {timeout}s", "exit_code": -1}
    except Exception as e:
        return {"ok": False, "stdout": "", "stderr": str(e), "exit_code": -1}


def export_chat(args):
    """Export a research conversation to file.
    Args: {messages, format, thread_title}
    Returns: {ok, path, size}
    """
    messages = args.get("messages", [])
    fmt = args.get("format", "markdown")
    title = args.get("thread_title", "Research Export")

    if not messages:
        return {"error": "No messages to export."}

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    safe_title = re.sub(r'[<>:"/\\|?*]', '_', title)[:50]

    if fmt == "markdown":
        content = f"# {title}\n\n*Exported from Zenith Research — {time.strftime('%Y-%m-%d %H:%M')}*\n\n---\n\n"
        for m in messages:
            role = m.get("role", "user").capitalize()
            text = m.get("content", "")
            if role == "User":
                content += f"## You\n\n{text}\n\n"
            elif role == "Assistant":
                content += f"## Assistant\n\n{text}\n\n"
            elif role == "Tool":
                content += f"### Tool Result\n\n{text}\n\n"
            content += "---\n\n"
        ext = ".md"

    elif fmt == "json":
        content = json.dumps({"title": title, "exported_at": time.strftime('%Y-%m-%dT%H:%M:%S'), "messages": messages}, indent=2, ensure_ascii=False)
        ext = ".json"

    elif fmt == "latex":
        content = "\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{hyperref}\n"
        content += f"\\title{{{title}}}\n\\date{{\\today}}\n\\begin{{document}}\n\\maketitle\n\n"
        for m in messages:
            role = m.get("role", "user")
            text = m.get("content", "").replace("&", "\\&").replace("%", "\\%").replace("#", "\\#").replace("_", "\\_")
            if role == "user":
                content += f"\\subsection*{{User}}\n{text}\n\n"
            elif role == "assistant":
                content += f"\\subsection*{{Assistant}}\n{text}\n\n"
        content += "\\end{document}\n"
        ext = ".tex"

    elif fmt == "bibtex":
        # Extract paper references from messages
        content = f"% BibTeX export from Zenith Research — {title}\n% Generated {time.strftime('%Y-%m-%d')}\n\n"
        entry_count = 0
        for m in messages:
            data = m.get("data")
            if data and isinstance(data, list):
                for paper in data:
                    if isinstance(paper, dict) and paper.get("title"):
                        entry_count += 1
                        key = re.sub(r'[^a-zA-Z0-9]', '', (paper.get("authors", ["unknown"])[0] if paper.get("authors") else "unknown"))
                        key += str(paper.get("year", ""))
                        content += f"@article{{{key}{entry_count},\n"
                        content += f"  title = {{{paper.get('title', '')}}},\n"
                        if paper.get("authors"):
                            content += f"  author = {{{' and '.join(paper['authors'][:5])}}},\n"
                        if paper.get("year"):
                            content += f"  year = {{{paper['year']}}},\n"
                        if paper.get("doi"):
                            content += f"  doi = {{{paper['doi']}}},\n"
                        if paper.get("url"):
                            content += f"  url = {{{paper['url']}}},\n"
                        content += "}\n\n"
        if entry_count == 0:
            content += "% No paper references found in this conversation.\n"
        ext = ".bib"

    elif fmt == "pdf":
        # Full markdown-to-PDF via reportlab with proper rendering
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.platypus import (
                SimpleDocTemplate, Paragraph, Spacer, Preformatted,
                Table, TableStyle, HRFlowable,
            )
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import cm, mm
            from reportlab.lib.colors import HexColor
            from reportlab.lib.enums import TA_LEFT

            out_path = os.path.join(EXPORTS_DIR, f"{safe_title}_{timestamp}.pdf")
            doc = SimpleDocTemplate(
                out_path, pagesize=A4,
                leftMargin=2 * cm, rightMargin=2 * cm,
                topMargin=2 * cm, bottomMargin=2 * cm,
            )
            styles = getSampleStyleSheet()

            # ── Custom styles ──
            styles.add(ParagraphStyle(
                "MDH1", parent=styles["Heading1"], fontSize=18, spaceAfter=10, spaceBefore=14,
                textColor=HexColor("#1a1a2e"),
            ))
            styles.add(ParagraphStyle(
                "MDH2", parent=styles["Heading2"], fontSize=15, spaceAfter=8, spaceBefore=12,
                textColor=HexColor("#1a1a2e"),
            ))
            styles.add(ParagraphStyle(
                "MDH3", parent=styles["Heading3"], fontSize=13, spaceAfter=6, spaceBefore=10,
                textColor=HexColor("#2a2a4e"),
            ))
            styles.add(ParagraphStyle(
                "MDH4", parent=styles["Heading4"], fontSize=11, spaceAfter=4, spaceBefore=8,
                textColor=HexColor("#2a2a4e"),
            ))
            styles.add(ParagraphStyle(
                "CodeBlock", fontName="Courier", fontSize=8, leading=10,
                backColor=HexColor("#f5f5f5"), textColor=HexColor("#333333"),
                leftIndent=12, rightIndent=12, spaceBefore=6, spaceAfter=6,
                borderPadding=(6, 6, 6, 6),
            ))
            styles.add(ParagraphStyle(
                "MDBody", parent=styles["Normal"], fontSize=10, leading=14,
                spaceAfter=4, alignment=TA_LEFT,
            ))
            styles.add(ParagraphStyle(
                "Blockquote", parent=styles["Normal"], fontSize=10, leading=13,
                leftIndent=20, textColor=HexColor("#555555"), fontName="Helvetica-Oblique",
                spaceBefore=4, spaceAfter=4,
            ))
            styles.add(ParagraphStyle(
                "BulletItem", parent=styles["Normal"], fontSize=10, leading=13,
                leftIndent=20, bulletIndent=10, spaceBefore=1, spaceAfter=1,
            ))
            styles.add(ParagraphStyle(
                "RoleLabel", parent=styles["Heading3"], fontSize=11, spaceAfter=4,
                spaceBefore=8, textColor=HexColor("#0891b2"),
            ))

            def _esc(t):
                """Escape HTML entities for reportlab Paragraph markup."""
                return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

            def _inline(t):
                """Convert inline markdown to reportlab XML: bold, italic, code, links."""
                t = _esc(t)
                # Bold: **text**
                t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
                # Italic: *text*
                t = re.sub(r'\*(.+?)\*', r'<i>\1</i>', t)
                # Inline code: `text`
                t = re.sub(r'`(.+?)`', r'<font face="Courier" size="8" color="#c0392b">\1</font>', t)
                # Links: [text](url)
                t = re.sub(r'\[(.+?)\]\((.+?)\)', r'<a href="\2" color="blue">\1</a>', t)
                # Bare URLs
                t = re.sub(r'(https?://[^\s<>]+)', r'<a href="\1" color="blue">\1</a>', t)
                return t

            def _md_to_flowables(md_text):
                """Convert markdown text to a list of reportlab flowables."""
                flowables = []
                lines = md_text.split("\n")
                i = 0
                while i < len(lines):
                    line = lines[i]

                    # Code block
                    if line.strip().startswith("```"):
                        code_lines = []
                        i += 1
                        while i < len(lines) and not lines[i].strip().startswith("```"):
                            code_lines.append(lines[i])
                            i += 1
                        i += 1  # skip closing ```
                        code_text = _esc("\n".join(code_lines))
                        flowables.append(Preformatted(code_text, styles["CodeBlock"]))
                        continue

                    # Headers
                    hm = re.match(r'^(#{1,4})\s+(.+)$', line)
                    if hm:
                        level = len(hm.group(1))
                        style_name = f"MDH{level}"
                        flowables.append(Paragraph(_inline(hm.group(2)), styles[style_name]))
                        i += 1
                        continue

                    # Horizontal rule
                    if re.match(r'^-{3,}$', line.strip()) or re.match(r'^\*{3,}$', line.strip()):
                        flowables.append(HRFlowable(
                            width="100%", thickness=0.5,
                            color=HexColor("#cccccc"), spaceBefore=6, spaceAfter=6,
                        ))
                        i += 1
                        continue

                    # Blockquote
                    bq = re.match(r'^>\s?(.*)$', line)
                    if bq:
                        flowables.append(Paragraph(_inline(bq.group(1)), styles["Blockquote"]))
                        i += 1
                        continue

                    # Table: detect | header | header | lines
                    if line.strip().startswith("|") and "|" in line[1:]:
                        table_rows = []
                        while i < len(lines) and lines[i].strip().startswith("|"):
                            row_line = lines[i].strip()
                            # Skip separator rows like |:---|:---|
                            if re.match(r'^\|[\s:|-]+\|$', row_line):
                                i += 1
                                continue
                            cells = [c.strip() for c in row_line.split("|")[1:-1]]
                            table_rows.append(cells)
                            i += 1
                        if table_rows:
                            # Normalize column count
                            max_cols = max(len(r) for r in table_rows)
                            for r in table_rows:
                                while len(r) < max_cols:
                                    r.append("")
                            # Convert cells to Paragraphs for wrapping
                            pdf_data = []
                            for ri, row in enumerate(table_rows):
                                pdf_row = []
                                for cell in row:
                                    st = styles["MDBody"] if ri > 0 else styles["MDH4"]
                                    pdf_row.append(Paragraph(_inline(cell), st))
                                pdf_data.append(pdf_row)
                            # Build table with styling
                            col_w = (A4[0] - 4 * cm) / max_cols
                            tbl = Table(pdf_data, colWidths=[col_w] * max_cols)
                            tbl.setStyle(TableStyle([
                                ("BACKGROUND", (0, 0), (-1, 0), HexColor("#e8e8e8")),
                                ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#1a1a2e")),
                                ("FONTSIZE", (0, 0), (-1, -1), 9),
                                ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#cccccc")),
                                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("TOPPADDING", (0, 0), (-1, -1), 4),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                            ]))
                            flowables.append(Spacer(1, 4 * mm))
                            flowables.append(tbl)
                            flowables.append(Spacer(1, 4 * mm))
                        continue

                    # Unordered list item
                    ul = re.match(r'^(\s*)[-*]\s+(.+)$', line)
                    if ul:
                        indent = len(ul.group(1)) // 2
                        bullet = "\u2022 " if indent == 0 else "  \u25E6 "
                        st = ParagraphStyle(
                            f"_bullet_{i}", parent=styles["BulletItem"],
                            leftIndent=20 + indent * 14,
                        )
                        flowables.append(Paragraph(bullet + _inline(ul.group(2)), st))
                        i += 1
                        continue

                    # Ordered list item
                    ol = re.match(r'^(\s*)(\d+)[.)]\s+(.+)$', line)
                    if ol:
                        indent = len(ol.group(1)) // 2
                        num = ol.group(2)
                        st = ParagraphStyle(
                            f"_ol_{i}", parent=styles["BulletItem"],
                            leftIndent=20 + indent * 14,
                        )
                        flowables.append(Paragraph(f"{num}. " + _inline(ol.group(3)), st))
                        i += 1
                        continue

                    # Empty line → small spacer
                    if not line.strip():
                        flowables.append(Spacer(1, 3 * mm))
                        i += 1
                        continue

                    # Regular paragraph — accumulate consecutive non-empty lines
                    para_lines = []
                    while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith(("#", "```", "|", ">", "---", "***", "- ", "* ")):
                        # Also break on numbered list items
                        if re.match(r'^\s*\d+[.)]\s+', lines[i]):
                            break
                        para_lines.append(lines[i])
                        i += 1
                    if para_lines:
                        flowables.append(Paragraph(_inline(" ".join(para_lines)), styles["MDBody"]))
                    else:
                        # Single line that didn't match anything
                        flowables.append(Paragraph(_inline(line), styles["MDBody"]))
                        i += 1

                return flowables

            # ── Build the PDF ──
            story = []
            story.append(Paragraph(_esc(title), styles["Title"]))
            story.append(Paragraph(
                f'<font size="9" color="#888888">Exported from Zenith Research \u2014 {time.strftime("%Y-%m-%d %H:%M")}</font>',
                styles["Normal"],
            ))
            story.append(Spacer(1, 0.5 * cm))
            story.append(HRFlowable(width="100%", thickness=1, color=HexColor("#0891b2"), spaceBefore=4, spaceAfter=10))

            for m in messages:
                role = m.get("role", "user").capitalize()
                text = m.get("content", "")
                mtype = m.get("type", "text")

                # Role header
                role_label = {"User": "You", "Assistant": "Assistant", "Tool": f"Tool: {m.get('tool_used', 'result')}", "System": "System"}.get(role, role)
                story.append(Paragraph(role_label, styles["RoleLabel"]))

                # Convert full message content via markdown parser — NO truncation
                story.extend(_md_to_flowables(text))

                # If the message has paper data, render it as a table
                data = m.get("data")
                if data and isinstance(data, list) and mtype == "papers":
                    paper_rows = [["Title", "Authors", "Year", "Citations"]]
                    for p in data[:20]:
                        if isinstance(p, dict) and p.get("title"):
                            authors = ", ".join(p.get("authors", [])[:3])
                            if len(p.get("authors", [])) > 3:
                                authors += " et al."
                            paper_rows.append([
                                p.get("title", "")[:80],
                                authors[:40],
                                str(p.get("year", "")),
                                str(p.get("citations", "")),
                            ])
                    if len(paper_rows) > 1:
                        col_widths = [200, 120, 40, 50]
                        ptbl = Table(
                            [[Paragraph(_esc(c), styles["MDBody"]) for c in row] for row in paper_rows],
                            colWidths=col_widths,
                        )
                        ptbl.setStyle(TableStyle([
                            ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0891b2")),
                            ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#ffffff")),
                            ("FONTSIZE", (0, 0), (-1, -1), 8),
                            ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#cccccc")),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("TOPPADDING", (0, 0), (-1, -1), 3),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                        ]))
                        story.append(Spacer(1, 3 * mm))
                        story.append(ptbl)

                story.append(Spacer(1, 3 * mm))
                story.append(HRFlowable(width="100%", thickness=0.3, color=HexColor("#dddddd"), spaceBefore=2, spaceAfter=6))

            doc.build(story)
            size = os.path.getsize(out_path)
            return {"ok": True, "path": out_path, "size": size, "format": "pdf"}
        except ImportError:
            # Fallback: save as markdown with .pdf note
            fmt = "markdown"
            ext = ".md"
            content = f"# {title}\n\n*PDF export requires reportlab. Exported as Markdown instead.*\n\n"
            for m in messages:
                role = m.get("role", "user").capitalize()
                content += f"## {role}\n\n{m.get('content', '')}\n\n---\n\n"
    else:
        return {"error": f"Unknown export format: {fmt}"}

    # Write file
    out_path = os.path.join(EXPORTS_DIR, f"{safe_title}_{timestamp}{ext}")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(content)

    size = os.path.getsize(out_path)
    return {"ok": True, "path": out_path, "size": size, "format": fmt}


def generate_section(args):
    """Generate a research paper section.
    Args: {section_type, context, api_key, provider, model}
    Returns: {ok, text, tokens}
    """
    section_type = args.get("section_type", "related_work")
    context = args.get("context", "")
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")

    if not api_key:
        return {"error": "API key required."}

    SECTION_PROMPTS = {
        "abstract": "Write a concise academic abstract (150-250 words) for the following research:",
        "introduction": "Write an introduction section for the following research, including motivation, problem statement, and contributions:",
        "related_work": "Write a related work section reviewing the literature for:",
        "methodology": "Write a methodology section describing the approach for:",
        "results": "Write a results section presenting the findings for:",
        "conclusion": "Write a conclusion section summarizing the key findings and future work for:",
        "discussion": "Write a discussion section analyzing the implications of:",
    }

    sys_prompt = (
        "You are an expert academic writer. Write in formal academic style with proper citations. "
        "Use LaTeX citation commands like \\cite{} where appropriate. "
        "Be thorough, precise, and well-structured."
    )

    section_prompt = SECTION_PROMPTS.get(section_type, f"Write a {section_type} section for:")
    full_prompt = f"{section_prompt}\n\n{context}"

    result = _llm_chat(provider, api_key, model,
                       [{"role": "system", "content": sys_prompt},
                        {"role": "user", "content": full_prompt}],
                       temperature=0.4, max_tokens=4096)

    if "error" in result:
        return result

    return {
        "ok": True, "text": result["text"],
        "tokens": result.get("usage"),
        "section_type": section_type,
    }
