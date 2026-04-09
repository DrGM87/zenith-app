import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useResearchStore, type StudyDesign, type PipelineStepConfig, type PipelineConfig, type PaperResult } from "../../stores/useResearchStore";
import { STUDY_DESIGNS, THEME as t } from "./shared/constants";
import { estimateCost, trackTokenUsage } from "./shared/helpers";
import type { ZenithSettings } from "./shared/types";
import { AgentActivityFeed } from "./AgentActivityFeed";
import { PaperBrowser } from "./PaperBrowser";
import { ManuscriptPreview } from "./ManuscriptPreview";

interface PipelineViewProps {
  settings: ZenithSettings | null;
  onToast: (msg: string) => void;
}

export function PipelineView({ settings, onToast }: PipelineViewProps) {
  const {
    params, pipeline, activeThread,
    setPipeline, resetPipeline, addPipelineLog, addPipelineTokens, addMessage, renameThread, setViewMode,
  } = useResearchStore();

  const [query, setQuery] = useState("");
  const [design, setDesign] = useState<StudyDesign>("systematic_review");
  const [bottomTab, setBottomTab] = useState<"papers" | "manuscript">("papers");
  const abortRef = useRef(false);
  const thread = activeThread();

  const log = useCallback((phase: string, message: string, level: "info" | "warn" | "error" | "success" = "info") => {
    addPipelineLog(phase, message, level);
  }, [addPipelineLog]);

  const trackTokens = useCallback((result: Record<string, unknown>) => {
    const tokens = result?.tokens as { input_tokens?: number; output_tokens?: number } | undefined;
    if (tokens) {
      const inp = tokens.input_tokens || 0;
      const out = tokens.output_tokens || 0;
      const cost = estimateCost(params.provider, params.model, inp, out);
      addPipelineTokens(inp, out, cost);
      trackTokenUsage(params.provider, params.model, inp, out, cost);
    }
  }, [params.provider, params.model, addPipelineTokens]);

  const handleRun = useCallback(async () => {
    if (!query.trim() || !params.api_key) {
      onToast(!params.api_key ? "Set an API key first" : "Enter a research question");
      return;
    }

    abortRef.current = false;
    setPipeline({ active: true, phase: "validating", progress: 0, query, studyDesign: design, error: null, papers: [], relevantPapers: [], acquiredPdfs: [], extractedTexts: [], searchQueries: [], blueprint: null, draftSections: [], citationIssues: [], guidelinesIssues: [], manuscript: "", bibliography: "", logs: [], totalTokens: { input: 0, output: 0, cost: 0 } });

    const designPromptMap: Record<string, string> = {
      systematic_review: "research_pipeline", meta_analysis: "research_pipeline",
      narrative_review: "research_pipeline", scoping_review: "research_pipeline",
      subject_review: "subject_review", educational: "educational",
      case_study: "case_study", comparative: "comparative", exploratory: "exploratory",
    };
    const promptKey = designPromptMap[design] || "research_pipeline";
    const prompts = settings?.ai_prompts as Record<string, string> | undefined;
    const pipelinePrompt = prompts?.[promptKey] ?? prompts?.research_pipeline ?? "";
    const pc = settings?.pipeline_config;
    const stepConfig = (key: keyof PipelineConfig): PipelineStepConfig | undefined => pc?.[key];
    const baseArgs = {
      api_key: params.api_key, provider: params.provider, model: params.model,
      system_prompt: pipelinePrompt, study_design: design,
      tavily_api_key: settings?.tavily_api_key ?? "",
      brave_api_key: (settings?.brave_api_key as string) ?? "",
      firecrawl_api_key: (settings?.firecrawl_api_key as string) ?? "",
    };

    const runPhase = async (phase: string, args: Record<string, unknown>) => {
      return JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase, ...args }),
      }));
    };

    try {
      // ── Step 1: Gatekeeper ──
      log("validate", "Validating research question...");
      setPipeline({ phase: "validating", progress: 5, statusMessage: "Validating research question..." });
      const vr = await runPhase("validate", { query, step_config: stepConfig("gatekeeper"), ...baseArgs });
      trackTokens(vr);
      if (abortRef.current) return;
      if (!vr.ok || vr.is_valid === false) {
        log("validate", `Query INVALID: ${vr.reason || vr.error}`, "error");
        setPipeline({ phase: "error", error: `Query invalid: ${vr.reason || vr.error}`, active: false });
        return;
      }
      log("validate", `Valid. Domain: ${vr.domain || "general"}`, "success");
      setPipeline({ progress: 10 });

      // ── Step 2: Query Architect ──
      log("queries", "Generating search queries...");
      setPipeline({ phase: "generating_queries", progress: 15, statusMessage: "Generating search queries..." });
      const qr = await runPhase("generate_queries", { query, domain: vr.domain, step_config: stepConfig("query_architect"), ...baseArgs });
      trackTokens(qr);
      if (abortRef.current) return;
      const searchQueries = Array.isArray(qr?.queries) ? qr.queries : [{ db: "pubmed", query_string: query, description: "Direct search" }];
      log("queries", `Generated ${searchQueries.length} queries`, "success");
      setPipeline({ searchQueries, progress: 20 });

      // ── Step 3-7: Multi-DB Harvest ──
      log("harvest", "Searching PubMed, Semantic Scholar, OpenAlex, arXiv...");
      setPipeline({ phase: "harvesting", progress: 25, statusMessage: "Searching databases..." });
      const hr = await runPhase("harvest", { query, search_queries: searchQueries, ...baseArgs });
      if (abortRef.current) return;
      const allPapers: PaperResult[] = Array.isArray(hr?.papers) ? hr.papers : [];
      log("harvest", `Found ${allPapers.length} papers from: ${(hr?.sources || []).join(", ")}`, allPapers.length > 0 ? "success" : "warn");
      setPipeline({ papers: allPapers, progress: 40 });

      if (allPapers.length === 0) {
        log("harvest", "No papers found.", "error");
        setPipeline({ phase: "error", error: "No papers found. Try broadening your query.", active: false });
        return;
      }

      // ── Step 8-10: Screen (Triage) ──
      log("triage", `Screening ${allPapers.length} papers...`);
      setPipeline({ phase: "triaging", progress: 45, statusMessage: `Screening ${allPapers.length} papers...` });
      const tr = await runPhase("triage", { papers: allPapers.slice(0, 40), query, step_config: stepConfig("triage_agent"), ...baseArgs });
      trackTokens(tr);
      if (abortRef.current) return;
      const relevant = tr.ok ? allPapers.filter((_: PaperResult, i: number) => tr.results?.[i]?.is_relevant !== false) : allPapers;
      log("triage", `${relevant.length}/${allPapers.length} relevant`, "success");
      setPipeline({ relevantPapers: relevant, progress: 55 });

      // ── Step 13-15: Acquire PDFs ──
      const withDoi = relevant.filter((p: PaperResult) => p.doi).slice(0, 15);
      let acquired: { doi: string; path: string; title: string }[] = [];
      if (withDoi.length > 0) {
        log("acquire", `Acquiring ${withDoi.length} papers...`);
        setPipeline({ phase: "acquiring", progress: 58, statusMessage: `Acquiring ${withDoi.length} papers...` });
        const ar = await runPhase("acquire", { papers: withDoi, skip_unpaywall: false, ...baseArgs });
        if (abortRef.current) return;
        acquired = Array.isArray(ar?.acquired) ? ar.acquired : [];
        log("acquire", `Acquired ${acquired.length}/${withDoi.length} PDFs`, acquired.length > 0 ? "success" : "warn");
        setPipeline({ acquiredPdfs: acquired, progress: 65 });

        // ── Step 17: Extract text from PDFs ──
        if (acquired.length > 0) {
          log("extract", `Extracting text from ${acquired.length} PDFs...`);
          setPipeline({ phase: "extracting", progress: 68, statusMessage: "Extracting text..." });
          const er = await runPhase("extract", { paths: acquired.map((a) => a.path), ...baseArgs });
          if (abortRef.current) return;
          const extracted = Array.isArray(er?.results) ? er.results.filter((r: { ok: boolean }) => r.ok) : [];
          log("extract", `Extracted ${extracted.length}/${acquired.length}`, "success");
          setPipeline({ extractedTexts: extracted, progress: 72 });
        }
      } else {
        setPipeline({ progress: 72, statusMessage: "No DOIs — using abstracts" });
      }

      // ── Step 20-21: Vector DB Ingest ──
      if (abortRef.current) return;
      const currentExtracted = useResearchStore.getState().pipeline.extractedTexts;
      const projectId = thread?.id || "default";
      if (currentExtracted.length > 0) {
        log("vectordb", "Ingesting into vector database...");
        setPipeline({ phase: "ingesting", progress: 73, statusMessage: "Building vector database..." });
        const vdbPapers = currentExtracted.map((e, i) => ({ title: acquired[i]?.title || `Paper ${i + 1}`, doi: acquired[i]?.doi || "", text: e.text || "" }));
        const vr2 = await runPhase("ingest_vectordb", { project_id: projectId, papers: vdbPapers, query });
        if (vr2.warning) log("vectordb", vr2.warning, "warn");
        else log("vectordb", `Stored ${vr2.chunks_stored} chunks`, "success");
      }

      // ── Step 31: Blueprint Architect ──
      if (abortRef.current) return;
      log("blueprint", "Generating paper blueprint...");
      setPipeline({ phase: "blueprinting", progress: 74, statusMessage: "Generating blueprint..." });
      const papersContext = relevant.slice(0, 20).map((p: PaperResult, i: number) =>
        `[${i + 1}] "${p.title}" (${p.authors?.slice(0, 3).join(", ") || "Unknown"}, ${p.year || "n.d."}). ${p.abstract?.slice(0, 300) || ""}`
      ).join("\n");
      const extractedContext = useResearchStore.getState().pipeline.extractedTexts.slice(0, 10).map((e) => e.text?.slice(0, 2000) || "").filter(Boolean).join("\n---\n");
      const br = await runPhase("blueprint", { query, papers_context: papersContext, extracted_texts: extractedContext, step_config: stepConfig("blueprint_agent"), ...baseArgs });
      trackTokens(br);
      if (abortRef.current) return;
      let blueprint = null;
      if (br.ok) {
        blueprint = { sections: br.sections || [], figure_plan: br.figure_plan || [], table_plan: br.table_plan || [], guidelines_map: br.guidelines_map || {} };
        setPipeline({ blueprint, progress: 78 });
        log("blueprint", `${blueprint.sections.length} sections planned`, "success");
      } else {
        log("blueprint", `Failed: ${br.error}`, "warn");
      }

      // ── Step 32: Section Drafter (loops) ──
      const sectionTypes = blueprint?.sections?.length
        ? blueprint.sections.map((s: { id?: string; title: string }) => s.id || s.title.toLowerCase().replace(/\s+/g, "_"))
        : ["introduction", "methodology", "results", "discussion"];
      const sectionTitles = blueprint?.sections?.length
        ? blueprint.sections.map((s: { title: string }) => s.title)
        : ["Introduction", "Methodology", "Results", "Discussion"];
      const draftSections: { type: string; text: string; figures?: string[]; tables?: string[] }[] = [];

      for (let si = 0; si < sectionTypes.length; si++) {
        if (abortRef.current) return;
        const sType = sectionTypes[si];
        const sTitle = sectionTitles[si];
        const pct = 78 + (si / sectionTypes.length) * 10;
        log("draft", `Drafting "${sTitle}"...`);
        setPipeline({ phase: "drafting", progress: Math.round(pct), statusMessage: `Drafting ${sTitle}...` });
        const blueprintReqs = blueprint?.sections?.[si]
          ? `Section: ${blueprint.sections[si].title}\nDescription: ${blueprint.sections[si].description}\nRequirements: ${blueprint.sections[si].requirements}` : "";
        const dr = await runPhase("draft", { section_type: sType, query, papers_context: papersContext, extracted_texts: extractedContext, blueprint_requirements: blueprintReqs, project_id: projectId, step_config: stepConfig("lead_author"), ...baseArgs });
        trackTokens(dr);
        if (dr.ok) {
          draftSections.push({ type: sType, text: dr.text, figures: dr.figures || [], tables: dr.tables || [] });
          log("draft", `${sTitle}: ${dr.text.length} chars`, "success");
        } else {
          log("draft", `${sTitle}: FAILED`, "error");
        }
      }
      setPipeline({ draftSections, progress: 88 });

      // ── Step 33-37: Figures & Tables ──
      const figurePlan = blueprint?.figure_plan || [];
      const tablePlan = blueprint?.table_plan || [];
      if (figurePlan.length > 0 || tablePlan.length > 0) {
        if (abortRef.current) return;
        log("figures", `Generating ${figurePlan.length} figures + ${tablePlan.length} tables...`);
        setPipeline({ phase: "generating_figures", progress: 86, statusMessage: "Generating charts & tables..." });
        try {
          const fr = await runPhase("generate_figures", { figure_plan: figurePlan, table_plan: tablePlan, draft_sections: draftSections, papers_context: papersContext, query, ...baseArgs });
          trackTokens(fr);
          if (fr.ok) {
            setPipeline({ generatedFigures: fr.figures || [], generatedTables: fr.tables || [] });
            log("figures", `Generated ${(fr.figures || []).length} figures, ${(fr.tables || []).length} tables`, "success");
          }
        } catch (e) { log("figures", `Error: ${String(e)}`, "error"); }
      }
      setPipeline({ progress: 88 });

      // ── Step 38-40: Quality Swarm ──
      if (draftSections.length > 0) {
        // Citation Verifier
        log("citation_verify", "Verifying citations...");
        setPipeline({ phase: "citation_verifying", progress: 89, statusMessage: "Verifying citations..." });
        const cv = await runPhase("citation_verify_swarm", { sections: draftSections, papers: relevant.slice(0, 30), query, step_config: stepConfig("citation_verifier"), ...baseArgs });
        trackTokens(cv);
        const citIssues = cv.ok ? (cv.issues || []) : [];
        setPipeline({ citationIssues: citIssues });
        log("citation_verify", `${citIssues.length} issue(s)`, citIssues.length === 0 ? "success" : "warn");

        // Guidelines Checker
        if (abortRef.current) return;
        log("guidelines", "Checking guidelines compliance...");
        setPipeline({ phase: "guidelines_checking", progress: 91, statusMessage: "Checking guidelines..." });
        const gc = await runPhase("guidelines_check", { sections: draftSections, query, guidelines_map: blueprint?.guidelines_map || {}, step_config: stepConfig("guidelines_compliance"), ...baseArgs });
        trackTokens(gc);
        const glIssues = (gc.ok ? (gc.checklist || []) : []).filter((it: { status: string }) => it.status !== "met");
        setPipeline({ guidelinesIssues: glIssues });
        log("guidelines", `${(gc.checklist || []).length - glIssues.length}/${(gc.checklist || []).length} items met`, glIssues.length === 0 ? "success" : "warn");
      }

      // ── Step 42: Prose Smoother ──
      if (draftSections.length > 0) {
        if (abortRef.current) return;
        log("smooth", "Polishing manuscript...");
        setPipeline({ phase: "smoothing", progress: 93, statusMessage: "Polishing..." });
        const sr = await runPhase("smooth", { sections: draftSections, query, papers: relevant.slice(0, 30), project_id: projectId, generated_figures: pipeline.generatedFigures || [], generated_tables: pipeline.generatedTables || [], citation_issues: useResearchStore.getState().pipeline.citationIssues, guidelines_issues: useResearchStore.getState().pipeline.guidelinesIssues, step_config: stepConfig("smoothing_pass"), ...baseArgs });
        trackTokens(sr);
        if (abortRef.current) return;
        if (sr.ok) {
          log("smooth", `Polished: ${sr.manuscript.length} chars`, "success");
          setPipeline({ manuscript: sr.manuscript, progress: 97 });
        } else { log("smooth", `Failed: ${sr.error}`, "error"); }
      }

      // ── Step 43: Citation Formatter ──
      log("compile", "Compiling bibliography...");
      setPipeline({ phase: "compiling", progress: 98, statusMessage: "Compiling bibliography..." });
      const rr = await runPhase("compile_refs", { papers: relevant.slice(0, 30), ...baseArgs });
      if (rr?.ok && rr.bibtex) {
        log("compile", `${rr.count || 0} references compiled`, "success");
        setPipeline({ bibliography: rr.bibtex });
      }

      // Auto-rename
      try {
        const ren = await runPhase("auto_rename", { content: query, api_key: params.api_key, provider: params.provider, model: params.model });
        if (ren?.ok && ren.title && thread) renameThread(thread.id, ren.title);
      } catch { /* */ }

      // Store results as messages
      if (thread) {
        addMessage(thread.id, { id: `sys-${Date.now()}`, role: "system", content: `Pipeline completed: "${query}"`, type: "text", timestamp: Date.now() });
        if (relevant.length > 0) {
          addMessage(thread.id, { id: `tool-${Date.now()}`, role: "tool", content: `Found ${allPapers.length} papers, ${relevant.length} relevant, ${acquired.length} acquired`, type: "papers", data: relevant.slice(0, 15), timestamp: Date.now(), tool_used: "Pipeline" });
        }
      }

      log("complete", `Done! ${allPapers.length} found, ${relevant.length} relevant, ${acquired.length} acquired. Manuscript: ${useResearchStore.getState().pipeline.manuscript.length} chars`, "success");
      setPipeline({ phase: "complete", progress: 100, active: false, statusMessage: "Complete!" });
      onToast("Pipeline complete!");
    } catch (e) {
      setPipeline({ phase: "error", error: String(e), active: false });
      onToast(`Pipeline error: ${String(e)}`);
    }
  }, [query, design, params, settings, thread, setPipeline, log, trackTokens, addMessage, renameThread, onToast, pipeline.generatedFigures, pipeline.generatedTables]);

  const isIdle = !pipeline.active && pipeline.phase !== "complete" && pipeline.phase !== "error";
  const hasResults = (pipeline.papers?.length ?? 0) > 0 || !!pipeline.manuscript;

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ fontFamily: t.font.sans }}>
      {isIdle ? (
        /* ── Launch Form ── */
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <div className="rounded-2xl p-8" style={{ background: t.bg.surface, border: `1px solid ${t.border.default}` }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: t.accent.emeraldDim, border: `1px solid ${t.accent.emeraldBorder}` }}>
                  <i className="fa-solid fa-bolt text-lg" style={{ color: t.accent.emerald }} />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold" style={{ color: t.text.primary }}>Research Pipeline</h2>
                  <p className="text-[11px]" style={{ color: t.text.muted }}>Autonomous search, screen, acquire, draft, verify, polish.</p>
                </div>
              </div>

              <textarea value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter your research question..."
                className="w-full rounded-xl px-4 py-3 text-[13px] placeholder:opacity-30 outline-none resize-none mb-4"
                style={{ background: t.bg.elevated, border: `1px solid ${t.border.subtle}`, color: t.text.primary, minHeight: 80 }}
                rows={3}
              />

              <div className="flex items-center gap-3 mb-5">
                <label className="text-[11px]" style={{ color: t.text.muted }}>Study Design:</label>
                <select value={design} onChange={(e) => setDesign(e.target.value as StudyDesign)}
                  className="px-3 py-1.5 rounded-lg text-[12px] outline-none appearance-none cursor-pointer"
                  style={{ background: t.bg.elevated, border: `1px solid ${t.border.subtle}`, color: t.text.secondary }}
                >
                  {STUDY_DESIGNS.map((d) => (
                    <option key={d.id} value={d.id} style={{ background: t.bg.surface }}>{d.label}</option>
                  ))}
                </select>
              </div>

              <button onClick={handleRun}
                disabled={!query.trim() || !params.api_key}
                className="w-full py-3 rounded-xl text-[13px] font-semibold transition-all cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                style={{ background: `linear-gradient(135deg, ${t.accent.emeraldDim}, ${t.accent.cyanDim})`, border: `1px solid ${t.accent.emeraldBorder}`, color: t.accent.emerald }}
              >
                <i className="fa-solid fa-play text-[10px] mr-2" />Launch Pipeline
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ── Running / Complete ── */
        <div className="flex-1 flex min-h-0">
          {/* Left: Agent Activity Feed */}
          <div className="w-[320px] border-r flex-shrink-0" style={{ borderColor: t.border.subtle, background: t.bg.base }}>
            <AgentActivityFeed />
          </div>

          {/* Right: Results */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Token/Cost bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: t.border.subtle }}>
              <div className="flex items-center gap-4 text-[10px]" style={{ fontFamily: t.font.mono }}>
                <span style={{ color: t.text.muted }}>
                  <i className="fa-solid fa-coins text-[8px] mr-1" style={{ color: `${t.accent.amber}88` }} />
                  ${pipeline.totalTokens.cost.toFixed(4)}
                </span>
                <span style={{ color: t.text.ghost }}>{pipeline.totalTokens.input.toLocaleString()} in / {pipeline.totalTokens.output.toLocaleString()} out</span>
              </div>
              <div className="flex items-center gap-2">
                {pipeline.active && (
                  <button onClick={() => { abortRef.current = true; setPipeline({ active: false, phase: "error", statusMessage: "Cancelled" }); }}
                    className="px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer"
                    style={{ color: t.accent.red, background: t.accent.redDim, border: `1px solid ${t.accent.red}30` }}
                  >
                    <i className="fa-solid fa-stop text-[8px] mr-1" />Stop
                  </button>
                )}
                {(pipeline.phase === "complete" || pipeline.phase === "error") && (
                  <>
                    <button onClick={() => setViewMode("chat")}
                      className="px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer"
                      style={{ color: t.accent.cyan, background: t.accent.cyanDim, border: `1px solid ${t.accent.cyanBorder}` }}
                    >
                      <i className="fa-solid fa-comments text-[8px] mr-1" />Chat
                    </button>
                    <button onClick={() => resetPipeline()}
                      className="px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer"
                      style={{ color: t.text.muted, background: t.bg.elevated, border: `1px solid ${t.border.subtle}` }}
                    >
                      <i className="fa-solid fa-rotate-right text-[8px] mr-1" />New
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Tabs */}
            {hasResults && (
              <div className="flex border-b" style={{ borderColor: t.border.subtle }}>
                {([
                  { id: "papers" as const, label: "Papers", icon: "fa-book", count: pipeline.relevantPapers?.length ?? pipeline.papers?.length ?? 0 },
                  { id: "manuscript" as const, label: "Manuscript", icon: "fa-file-lines", count: pipeline.manuscript ? 1 : 0 },
                ] as const).map((tab) => (
                  <button key={tab.id} onClick={() => setBottomTab(tab.id)}
                    className="relative px-4 py-2.5 text-[11px] font-medium transition-colors cursor-pointer"
                    style={{ color: bottomTab === tab.id ? t.text.primary : t.text.muted }}
                  >
                    <i className={`fa-solid ${tab.icon} text-[9px] mr-1.5`} />
                    {tab.label}
                    {tab.count > 0 && (
                      <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: t.bg.elevated, color: t.text.ghost, fontFamily: t.font.mono }}>
                        {tab.count}
                      </span>
                    )}
                    {bottomTab === tab.id && (
                      <motion.div layoutId="pipeline-tab" className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: t.accent.cyan }} />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>
              {bottomTab === "papers" ? (
                <PaperBrowser papers={pipeline.relevantPapers ?? pipeline.papers ?? []} acquiredDois={new Set((pipeline.acquiredPdfs ?? []).map((a) => a.doi))} />
              ) : (
                <ManuscriptPreview
                  manuscript={pipeline.manuscript}
                  bibliography={pipeline.bibliography}
                  figures={pipeline.generatedFigures ?? []}
                  tables={pipeline.generatedTables ?? []}
                  onToast={onToast}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
