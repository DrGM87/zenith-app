import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useResearchStore, type ResearchMessage } from "../../stores/useResearchStore";
import { THEME as t } from "./shared/constants";
import { uid, fmtTime, estimateCost, trackTokenUsage } from "./shared/helpers";
import type { ZenithSettings } from "./shared/types";

interface ChatViewProps {
  settings: ZenithSettings | null;
}

export function ChatView({ settings }: ChatViewProps) {
  const {
    activeThread, params, isGenerating,
    addMessage, removeMessagesFrom, setGenerating, renameThread,
  } = useResearchStore();

  const thread = activeThread();
  const messages = thread?.messages ?? [];

  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const abortRef = useRef(false);

  const handleStop = useCallback(() => {
    abortRef.current = true;
    setGenerating(false);
  }, [setGenerating]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isGenerating || !thread) return;
    abortRef.current = false;
    const userMsg: ResearchMessage = {
      id: uid(), role: "user", content: input.trim(),
      type: "text", timestamp: Date.now(),
    };
    addMessage(thread.id, userMsg);
    const savedInput = input;
    setInput("");
    setGenerating(true);
    const isFirst = messages.length === 0;

    try {
      const chatMessages = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const argsJson = JSON.stringify({
        messages: chatMessages, api_key: params.api_key, provider: params.provider,
        model: params.model, temperature: params.temperature, max_tokens: params.max_tokens,
        system_prompt: params.system_prompt, enabled_tools: params.enabled_tools,
        tavily_api_key: settings?.tavily_api_key ?? "",
        brave_api_key: (settings?.brave_api_key as string) ?? "",
        firecrawl_api_key: (settings?.firecrawl_api_key as string) ?? "",
      });

      const resultStr = await invoke<string>("process_file", { action: "research_chat", argsJson });
      const result = JSON.parse(resultStr);

      if (result.error) {
        addMessage(thread.id, { id: uid(), role: "assistant", content: result.error, type: "error", timestamp: Date.now() });
      } else {
        const cost = result.tokens
          ? estimateCost(params.provider, params.model, result.tokens.input || 0, result.tokens.output || 0)
          : 0;
        if (result.tokens) await trackTokenUsage(params.provider, params.model, result.tokens.input || 0, result.tokens.output || 0, cost);

        if (result.tool_results && Array.isArray(result.tool_results)) {
          for (const tr of result.tool_results) {
            addMessage(thread.id, {
              id: uid(), role: "tool", content: tr.summary || "",
              type: tr.type || "text", data: tr.data, timestamp: Date.now(), tool_used: tr.tool_name,
            });
          }
        }
        addMessage(thread.id, {
          id: uid(), role: "assistant", content: result.reply || result.content || "",
          type: result.type || "text", data: result.data, timestamp: Date.now(),
          tokens: result.tokens ? { input: result.tokens.input || 0, output: result.tokens.output || 0, cost } : undefined,
          tool_used: result.tool_used,
        });
      }

      if (isFirst && savedInput.trim().length > 0) {
        try {
          // Use model: "" to force the provider's fast/cheap default for rename
          const renameResult = JSON.parse(await invoke<string>("process_file", {
            action: "run_pipeline_phase",
            argsJson: JSON.stringify({ phase: "auto_rename", content: savedInput.trim(), api_key: params.api_key, provider: params.provider, model: "" }),
          }));
          renameThread(thread.id, renameResult?.ok && renameResult.title ? renameResult.title : savedInput.trim().slice(0, 60));
        } catch { renameThread(thread.id, savedInput.trim().slice(0, 60)); }
      }
    } catch (e) {
      addMessage(thread.id, { id: uid(), role: "assistant", content: `Error: ${String(e)}`, type: "error", timestamp: Date.now() });
    } finally { setGenerating(false); }
  }, [input, isGenerating, thread, messages, params, settings, addMessage, setGenerating, renameThread]);

  const handleEditRetry = useCallback((msgId: string) => {
    if (!thread || isGenerating) return;
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    setInput(msg.content);
    removeMessagesFrom(thread.id, msgId);
    inputRef.current?.focus();
  }, [thread, isGenerating, messages, removeMessagesFrom]);

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ fontFamily: t.font.sans }}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-5">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: t.accent.cyanDim, border: `1px solid ${t.accent.cyanBorder}` }}>
                <i className="fa-solid fa-dna text-3xl" style={{ color: t.accent.cyan }} />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: t.accent.emeraldDim, border: `1px solid ${t.accent.emeraldBorder}` }}>
                <i className="fa-solid fa-sparkles text-[10px]" style={{ color: t.accent.emerald }} />
              </div>
            </div>
            <div>
              <div className="text-[16px] font-semibold mb-1" style={{ color: t.text.secondary }}>Zenith Research</div>
              <div className="text-[12px] max-w-md leading-relaxed" style={{ color: t.text.muted }}>
                Search PubMed, download papers, verify citations, or switch to Pipeline for autonomous systematic reviews.
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg mt-1">
              {["Search PubMed for recent CRISPR therapy trials",
                "Check novelty of mRNA delivery approach",
                "Download DOI 10.1038/s41586-024-07386-0",
              ].map((q) => (
                <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="px-3 py-2 rounded-lg text-[11px] transition-all cursor-pointer border"
                  style={{ color: t.text.muted, background: t.bg.surface, borderColor: t.border.subtle }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.accent.cyanBorder; e.currentTarget.style.color = t.text.secondary; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border.subtle; e.currentTarget.style.color = t.text.muted; }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onEdit={() => handleEditRetry(msg.id)}
            onRetry={() => {
              // For user messages: edit-retry. For assistant errors: re-send last user msg.
              if (msg.role === "user") {
                handleEditRetry(msg.id);
              } else {
                const lastUser = [...messages].reverse().find((m) => m.role === "user");
                if (lastUser) handleEditRetry(lastUser.id);
              }
            }}
          />
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 pb-4 pt-2">
        <div className="relative rounded-xl overflow-hidden" style={{ background: t.bg.surface, border: `1px solid ${t.border.default}` }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Ask a research question..."
            rows={2}
            className="w-full px-4 py-3 text-[13px] placeholder:opacity-30 outline-none resize-none bg-transparent"
            style={{ color: t.text.primary, fontFamily: t.font.sans }}
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-1">
              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: t.text.ghost, background: t.bg.elevated, fontFamily: t.font.mono }}>
                {params.provider}/{params.model.split("-").slice(-2).join("-")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isGenerating && (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer"
                  style={{ background: t.accent.redDim, color: t.accent.red, border: `1px solid ${t.accent.red}40` }}
                >
                  <i className="fa-solid fa-stop text-[8px]" /> Stop
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={!input.trim() || isGenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                style={{ background: t.accent.cyanDim, color: t.accent.cyan, border: `1px solid ${t.accent.cyanBorder}` }}
              >
                {isGenerating ? (
                  <><i className="fa-solid fa-circle-notch fa-spin text-[9px]" /> Thinking...</>
                ) : (
                  <><i className="fa-solid fa-paper-plane text-[9px]" /> Send</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Message Bubble ───────────────────────────────────────────────────────────

function MsgActionBtn({ icon, title, onClick, color }: { icon: string; title: string; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] cursor-pointer transition-all opacity-0 group-hover:opacity-100"
      style={{ color: color ?? t.text.ghost, background: "transparent" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = t.bg.elevated; e.currentTarget.style.opacity = "1"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <i className={`${icon} text-[8px]`} />
    </button>
  );
}

function MessageBubble({ msg, onEdit, onRetry }: { msg: ResearchMessage; onEdit: () => void; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === "user";
  const isError = msg.type === "error";
  const isTool = msg.role === "tool";

  const copyContent = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`flex group ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[82%] rounded-xl px-4 py-3 ${isUser ? "rounded-br-sm" : "rounded-bl-sm"}`}
        style={{
          background: isUser ? t.accent.cyanDim
            : isError ? t.accent.redDim
            : isTool ? `${t.accent.amber}10`
            : t.bg.elevated,
          border: `1px solid ${
            isUser ? t.accent.cyanBorder
            : isError ? `${t.accent.red}30`
            : isTool ? `${t.accent.amber}20`
            : t.border.subtle
          }`,
        }}
      >
        {/* Tool badge */}
        {isTool && msg.tool_used && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <i className="fa-solid fa-wrench text-[8px]" style={{ color: t.accent.amber }} />
            <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: t.accent.amber, fontFamily: t.font.mono }}>
              {msg.tool_used}
            </span>
          </div>
        )}

        {/* Content */}
        <div className="zenith-prose select-text text-[13px]"
          style={{ color: isError ? `${t.accent.red}cc` : t.text.primary }}
        >
          {isUser || isError ? (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}
              components={{
                sup: ({ children }) => <sup style={{ color: t.accent.cyan, fontSize: "0.7em" }}>{children}</sup>,
                a: ({ href, children }) => <a href={href} style={{ color: t.accent.cyan, textDecoration: "underline" }} target="_blank" rel="noreferrer">{children}</a>,
                code: ({ children, className }) => className
                  ? <pre style={{ background: t.bg.elevated, border: `1px solid ${t.border.subtle}`, borderRadius: 6, padding: "8px 12px", overflowX: "auto", fontSize: 11, fontFamily: t.font.mono }}><code>{children}</code></pre>
                  : <code style={{ background: t.bg.elevated, borderRadius: 3, padding: "1px 4px", fontSize: "0.85em", fontFamily: t.font.mono, color: t.accent.amber }}>{children}</code>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-2 pt-1.5" style={{ borderTop: `1px solid ${t.border.subtle}` }}>
          <span className="text-[9px]" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>
            {fmtTime(msg.timestamp)}
            {msg.tokens && (
              <span className="ml-2" style={{ color: t.text.ghost }}>
                {(msg.tokens.input + msg.tokens.output).toLocaleString()} tok
                {msg.tokens.cost > 0 && ` · $${msg.tokens.cost.toFixed(5)}`}
              </span>
            )}
          </span>

          {/* Action buttons — visible on hover */}
          <div className="flex items-center gap-0.5">
            <MsgActionBtn
              icon={copied ? "fa-solid fa-check" : "fa-solid fa-copy"}
              title="Copy to clipboard"
              onClick={copyContent}
              color={copied ? t.accent.emerald : undefined}
            />
            {isUser && (
              <MsgActionBtn icon="fa-solid fa-pen" title="Edit and resend" onClick={onEdit} />
            )}
            {(isUser || isError) && (
              <MsgActionBtn icon="fa-solid fa-rotate-right" title="Retry this message" onClick={onRetry} color={t.accent.amber} />
            )}
            {!isUser && !isTool && (
              <MsgActionBtn
                icon="fa-solid fa-quote-right"
                title="Copy as quote"
                onClick={() => navigator.clipboard.writeText(`> ${msg.content.replace(/\n/g, "\n> ")}`)}
              />
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
