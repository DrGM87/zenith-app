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
_NO_TEMPERATURE_MODELS = frozenset({"o3", "o3-mini", "o4-mini"})

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
            mdl = model or "gpt-4.1-nano"
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
            mdl = model or "claude-sonnet-4-20250514"
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
            mdl = model or "gemini-2.5-flash"
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
            tools.append("- WEB_SEARCH: Search the web for information")
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
                "For NOVELTY_CHECK: {\"idea\": \"...\"}\n"
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

            tool_result = _execute_tool(tool_name, tool_args, api_key, provider, model)
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


def _execute_tool(tool_name, tool_args, api_key, provider, model):
    """Dispatch a tool call and return structured result."""
    tool_name = tool_name.upper().strip()

    if tool_name == "LITERATURE_SEARCH":
        query = tool_args.get("query", "")
        max_results = tool_args.get("max_results", 5)
        year_min = tool_args.get("year_min", None)

        all_papers = []
        all_papers.extend(_search_arxiv(query, max_results))
        time.sleep(0.5)  # rate-limit gap between sources (ARC pattern)
        all_papers.extend(_search_semantic_scholar(query, max_results, year_min))
        time.sleep(1.0)  # S2 is the most rate-limited
        all_papers.extend(_search_openalex(query, max_results))

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
        # Try DuckDuckGo (no API key needed)
        result = _web_search_duckduckgo(query)
        results = result.get("results", [])
        summary = f"Found {len(results)} web results for '{query}'."
        if results:
            summary += " " + "; ".join([f"{r['title']}" for r in results[:3]])
        return {"tool_name": "WEB_SEARCH", "type": "text", "data": results, "summary": summary}

    elif tool_name == "NOVELTY_CHECK":
        idea = tool_args.get("idea", "")
        # Search for similar papers
        papers = _search_semantic_scholar(idea, 10)
        similar = [p for p in papers if p.get("citations", 0) > 0][:5]

        summary = f"Novelty assessment for: \"{idea[:100]}...\"\n"
        if not similar:
            summary += "No closely related papers found — this appears to be a novel direction."
        else:
            summary += f"Found {len(similar)} potentially related papers:\n"
            for p in similar:
                summary += f"  - \"{p['title']}\" ({p.get('year','?')}, {p.get('citations',0)} cites)\n"

        return {"tool_name": "NOVELTY_CHECK", "type": "text", "data": similar, "summary": summary}

    elif tool_name == "CITATION_VERIFY":
        citations = tool_args.get("citations", [])
        if isinstance(citations, str):
            citations = [c.strip() for c in citations.split(";") if c.strip()]
        results = []
        for cite in citations[:10]:
            # Try to find via Semantic Scholar
            found = _search_semantic_scholar(cite, 1)
            if found:
                results.append({"ref": cite, "verified": True, "match": found[0].get("title", ""), "doi": found[0].get("doi", "")})
            else:
                results.append({"ref": cite, "verified": False, "match": "", "doi": ""})

        verified = sum(1 for r in results if r["verified"])
        summary = f"Verified {verified}/{len(results)} citations."
        return {"tool_name": "CITATION_VERIFY", "type": "text", "data": results, "summary": summary}

    elif tool_name == "EXPERIMENT":
        code = tool_args.get("code", "")
        summary = "Experiment execution is available but sandboxing is not yet implemented. Please review code manually."
        return {"tool_name": "EXPERIMENT", "type": "code", "data": code, "summary": summary}

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

    all_papers = []
    if "arxiv" in sources:
        all_papers.extend(_search_arxiv(query, max_results))
    if "semantic_scholar" in sources:
        all_papers.extend(_search_semantic_scholar(query, max_results, year_min))
    if "openalex" in sources:
        all_papers.extend(_search_openalex(query, max_results))

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


def verify_citations(args):
    """Verify a list of citations.
    Args: {citations: [str]}
    Returns: {ok, results: [{ref, verified, doi, url, error}]}
    """
    citations = args.get("citations", [])
    if isinstance(citations, str):
        citations = [c.strip() for c in citations.split("\n") if c.strip()]

    if not citations:
        return {"error": "No citations to verify."}

    results = []
    for cite in citations[:20]:  # limit to 20
        found = _search_semantic_scholar(cite, 1)
        if found and found[0].get("title"):
            results.append({
                "ref": cite, "verified": True,
                "title": found[0]["title"], "doi": found[0].get("doi", ""),
                "url": found[0].get("url", ""), "year": found[0].get("year", ""),
            })
        else:
            results.append({"ref": cite, "verified": False, "title": "", "doi": "", "url": "", "error": "Not found"})

    verified = sum(1 for r in results if r["verified"])
    return {"ok": True, "results": results, "verified_count": verified, "total": len(results)}


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
        # Simple text-based PDF via reportlab if available, otherwise fallback to markdown
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
            from reportlab.lib.styles import getSampleStyleSheet
            from reportlab.lib.units import cm

            out_path = os.path.join(EXPORTS_DIR, f"{safe_title}_{timestamp}.pdf")
            doc = SimpleDocTemplate(out_path, pagesize=A4)
            styles = getSampleStyleSheet()
            story = []
            story.append(Paragraph(title, styles['Title']))
            story.append(Spacer(1, 0.5 * cm))

            for m in messages:
                role = m.get("role", "user").capitalize()
                text = m.get("content", "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                text = text.replace("\n", "<br/>")
                story.append(Paragraph(f"<b>{role}:</b>", styles['Heading3']))
                story.append(Paragraph(text[:5000], styles['Normal']))
                story.append(Spacer(1, 0.3 * cm))

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
