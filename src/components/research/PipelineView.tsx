import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  useResearchStore,
  type StudyDesign, type PipelineStepConfig, type PipelineConfig, type PaperResult,
} from "../../stores/useResearchStore";
import { STUDY_DESIGNS, THEME as t } from "./shared/constants";
import { estimateCost, trackTokenUsage } from "./shared/helpers";
import type { ZenithSettings } from "./shared/types";
import { AgentActivityFeed } from "./AgentActivityFeed";
import { PaperBrowser } from "./PaperBrowser";
import { ManuscriptPreview } from "./ManuscriptPreview";

interface PipelineViewProps {
  settings: ZenithSettings | null;
  onToast: (msg: string) => void;
  setCaptchaUrl?: (url: string | null) => void;
}

// ── Phase checkpoint ordering for resume logic ───────────────────────────────
const PHASE_ORDER = [
  "validate", "generate_queries", "harvest", "triage",
  "acquire", "extract", "ingest", "blueprint", "draft",
  "generate_figures", "citation_verify_swarm", "guidelines_check", "smooth", "compile_refs",
];

function phaseAfter(phase: string): string | null {
  const idx = PHASE_ORDER.indexOf(phase);
  return idx >= 0 && idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PipelineView({ settings, onToast, setCaptchaUrl: _setCaptchaUrl }: PipelineViewProps) {
  const {
    params, pipeline, activeThread,
    setPipeline, resetPipeline, addPipelineLog, addPipelineTokens,
    addMessage, renameThread, setViewMode,
  } = useResearchStore();

  const [query, setQuery] = useState("");
  const [design, setDesign] = useState<StudyDesign>("systematic_review");
  const [bottomTab, setBottomTab] = useState<"papers" | "manuscript">("papers");
  const abortRef = useRef(false);
  const thread = activeThread();

  // ── Restore query/design from stored pipeline when thread has data ─────────
  useEffect(() => {
    if (pipeline.query) {
      setQuery(pipeline.query);
    }
    if (pipeline.studyDesign) {
      setDesign(pipeline.studyDesign as StudyDesign);
    }
    if (pipeline.manuscript) {
      setBottomTab("manuscript");
    }
  }, [pipeline.query, pipeline.studyDesign, pipeline.manuscript]);

  // ── When thread changes and pipeline is idle, prefill query from thread title ──
  const threadId = thread?.id;
  useEffect(() => {
    if (!threadId) return;
    const { pipeline: p } = useResearchStore.getState();
    // Only prefill if idle and query field is empty
    if (p.phase === "idle" && !query && thread?.title && thread.title !== "New Research") {
      setQuery(thread.title);
    }
  }, [threadId]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const log = useCallback((phase: string, message: string, level: "info" | "warn" | "error" | "success" = "info") => {
    addPipelineLog(phase, message, level);
  }, [addPipelineLog]);

  const trackTokens = useCallback((result: Record<string, unknown>) => {
    const tokens = result?.tokens as { input_tokens?: number; output_tokens?: number; input?: number; output?: number } | undefined;
    if (tokens) {
      const inp = tokens.input_tokens ?? tokens.input ?? 0;
      const out = tokens.output_tokens ?? tokens.output ?? 0;
      if (inp + out > 0) {
        const cost = estimateCost(params.provider, params.model, inp, out);
        addPipelineTokens(inp, out, cost);
        trackTokenUsage(params.provider, params.model, inp, out, cost);
      }
    }
  }, [params.provider, params.model, addPipelineTokens]);

  const runPhase = useCallback(async (phase: string, args: Record<string, unknown>) => {
    const raw = await invoke<string>("process_file", {
      action: "run_pipeline_phase",
      argsJson: JSON.stringify({ phase, ...args }),
    });
    const parsed = JSON.parse(raw);
    if (parsed?.error) {
      throw new Error(`[${phase}] ${parsed.error}`);
    }
    return parsed;
  }, []);

  // ── Main pipeline runner (supports checkpoint resume) ─────────────────────

  const handleRun = useCallback(async (
    overrideQuery?: string,
    overrideDesign?: StudyDesign,
    startFromPhase?: string,    // when set, skip phases before this key
  ) => {
    const q = overrideQuery ?? query;
    const d = overrideDesign ?? design;

    if (!q.trim() || !params.api_key) {
      onToast(!params.api_key ? "Set an API key in Settings first" : "Enter a research question");
      return;
    }

    abortRef.current = false;
    const isResume = !!startFromPhase;

    // Build base args
    const designPromptMap: Record<string, string> = {
      systematic_review: "research_pipeline", meta_analysis: "research_pipeline",
      narrative_review: "research_pipeline", scoping_review: "research_pipeline",
      subject_review: "subject_review", educational: "educational",
      case_study: "case_study", comparative: "comparative", exploratory: "exploratory",
    };
    const promptKey = designPromptMap[d] || "research_pipeline";
    const prompts = settings?.ai_prompts as Record<string, string> | undefined;
    const pipelinePrompt = prompts?.[promptKey] ?? prompts?.research_pipeline ?? "";
    const pc = settings?.pipeline_config;
    const stepConfig = (key: keyof PipelineConfig): PipelineStepConfig | undefined => pc?.[key];
    const baseArgs = {
      api_key: params.api_key, provider: params.provider, model: params.model,
      system_prompt: pipelinePrompt, study_design: d,
      tavily_api_key: settings?.tavily_api_key ?? "",
      brave_api_key: (settings?.brave_api_key as string) ?? "",
      firecrawl_api_key: (settings?.firecrawl_api_key as string) ?? "",
      embedding_model: settings?.embedding_model ?? "allenai/specter2",
    };

    // Snapshot stored intermediate data for resume
    const stored = useResearchStore.getState().pipeline;

    // Reset pipeline state (preserve intermediate data if resuming)
    setPipeline({
      active: true, phase: "validating", progress: 0, query: q, studyDesign: d,
      error: null, failedPhase: undefined, lastGoodPhase: undefined,
      ...(isResume ? {
        // Keep already-computed data; only clear logs for the new run
        logs: [...stored.logs, { time: new Date().toLocaleTimeString(), phase: "system", message: `↩ Resuming from [${startFromPhase}]`, level: "info" as const }],
      } : {
        papers: [], relevantPapers: [], acquiredPdfs: [], extractedTexts: [],
        searchQueries: [], blueprint: null, draftSections: [], generatedFigures: [],
        generatedTables: [], citationIssues: [], guidelinesIssues: [],
        manuscript: "", bibliography: "", logs: [],
        totalTokens: { input: 0, output: 0, cost: 0 },
      }),
    });

    // Phase skip helper: returns true if we should use stored data and skip this phase
    const startIdx = startFromPhase ? PHASE_ORDER.indexOf(startFromPhase) : -1;
    const shouldSkip = (phaseKey: string) => startIdx > 0 && PHASE_ORDER.indexOf(phaseKey) < startIdx;

    // Track which phases complete successfully for resume
    const markGood = (phaseKey: string) => setPipeline({ lastGoodPhase: phaseKey });

    try {
      // ── Step 1: Gatekeeper ─────────────────────────────────────────────
      if (!shouldSkip("validate")) {
        log("validate", "Validating research question with Gatekeeper...");
        setPipeline({ phase: "validating", progress: 5, statusMessage: "Validating research question..." });
        const vr = await runPhase("validate", { query: q, step_config: stepConfig("gatekeeper"), ...baseArgs });
        trackTokens(vr);
        if (abortRef.current) return;
        if (!vr.ok || vr.is_valid === false) {
          const reason = vr.reason || vr.message || "Query rejected by Gatekeeper";
          log("validate", `REJECTED: ${reason}`, "error");
          setPipeline({ phase: "error", error: `Gatekeeper rejected query: ${reason}`, active: false, failedPhase: "validate", progress: 5 });
          return;
        }
        log("validate", `Accepted. Domain: ${vr.domain || "general"}`, "success");
        markGood("validate");
        setPipeline({ progress: 10 });
      } else {
        log("validate", "Skipped (resuming)", "info");
        setPipeline({ progress: 10 });
      }

      // ── Step 2: Query Architect ────────────────────────────────────────
      let searchQueries = stored.searchQueries;
      if (!shouldSkip("generate_queries")) {
        log("queries", "Generating MeSH/Boolean search queries...");
        setPipeline({ phase: "generating_queries", progress: 15, statusMessage: "Generating search queries..." });
        const qr = await runPhase("generate_queries", { query: q, step_config: stepConfig("query_architect"), ...baseArgs });
        trackTokens(qr);
        if (abortRef.current) return;
        searchQueries = Array.isArray(qr?.queries) ? qr.queries : [{ db: "pubmed", query_string: q, description: "Direct search" }];
        log("queries", `Generated ${searchQueries.length} queries for: ${searchQueries.map((x: { db: string }) => x.db).join(", ")}`, "success");
        markGood("generate_queries");
        setPipeline({ searchQueries, progress: 20 });
      } else {
        log("queries", `Using stored ${searchQueries.length} queries`, "info");
        setPipeline({ progress: 20 });
      }

      // ── Step 3-7: Multi-DB Harvest ─────────────────────────────────────
      let allPapers: PaperResult[] = stored.papers;
      if (!shouldSkip("harvest")) {
        log("harvest", `Searching databases: PubMed, Semantic Scholar, OpenAlex, arXiv...`);
        setPipeline({ phase: "harvesting", progress: 25, statusMessage: "Searching academic databases..." });
        const hr = await runPhase("harvest", { query: q, search_queries: searchQueries, ...baseArgs });
        if (abortRef.current) return;
        allPapers = Array.isArray(hr?.papers) ? hr.papers : [];
        const sources = (hr?.sources || []).join(", ") || "unknown";
        log("harvest", `Found ${allPapers.length} papers across: ${sources}`, allPapers.length > 0 ? "success" : "warn");
        if (hr?.warnings?.length) hr.warnings.forEach((w: string) => log("harvest", w, "warn"));
        if (allPapers.length === 0) {
          const errMsg = "No papers found. Try broadening your query, checking your spelling, or enabling more search tools.";
          log("harvest", errMsg, "error");
          setPipeline({ phase: "error", error: errMsg, active: false, failedPhase: "harvest", progress: 25 });
          return;
        }
        markGood("harvest");
        setPipeline({ papers: allPapers, progress: 40 });
      } else {
        log("harvest", `Using stored ${allPapers.length} papers`, "info");
        setPipeline({ progress: 40 });
      }

      // ── Step 8-10: Triage (Title/Abstract Screen) ──────────────────────
      let relevant: PaperResult[] = stored.relevantPapers.length > 0 ? stored.relevantPapers : allPapers;
      if (!shouldSkip("triage")) {
        log("triage", `Screening ${allPapers.length} papers for relevance...`);
        setPipeline({ phase: "triaging", progress: 45, statusMessage: `Screening ${allPapers.length} papers...` });
        const tr = await runPhase("triage", {
          papers: allPapers.slice(0, 40), query: q,
          step_config: stepConfig("triage_agent"), ...baseArgs,
        });
        trackTokens(tr);
        if (abortRef.current) return;
        if (tr.ok && Array.isArray(tr.results)) {
          relevant = allPapers.filter((_: PaperResult, i: number) => tr.results[i]?.is_relevant !== false);
        } else {
          log("triage", `Triage incomplete (${tr.error || "no results"}) — using all papers`, "warn");
          relevant = allPapers;
        }
        log("triage", `${relevant.length}/${allPapers.length} papers are relevant`, "success");
        markGood("triage");
        setPipeline({ relevantPapers: relevant, progress: 55 });
      } else {
        log("triage", `Using stored ${relevant.length} relevant papers`, "info");
        setPipeline({ progress: 55 });
      }

      // ── Step 13-15: PDF Acquisition ────────────────────────────────────
      let acquired: { doi: string; path: string; title: string }[] = stored.acquiredPdfs;
      const withDoi = relevant.filter((p: PaperResult) => p.doi).slice(0, 15);
      if (!shouldSkip("acquire") && withDoi.length > 0) {
        log("acquire", `Acquiring ${withDoi.length} papers via Unpaywall / open access...`);
        setPipeline({ phase: "acquiring", progress: 58, statusMessage: `Acquiring ${withDoi.length} papers...` });
        const ar = await runPhase("acquire", {
          papers: withDoi, skip_unpaywall: false,
          scihub_mirrors: (settings as { scihub_mirrors?: string[] } | null)?.scihub_mirrors ?? [],
          ...baseArgs,
        });
        if (abortRef.current) return;
        acquired = Array.isArray(ar?.acquired) ? ar.acquired : [];
        log("acquire", `Acquired ${acquired.length}/${withDoi.length} PDFs`, acquired.length > 0 ? "success" : "warn");
        if (ar?.failed?.length) log("acquire", `${ar.failed.length} could not be acquired`, "warn");
        markGood("acquire");
        setPipeline({ acquiredPdfs: acquired, progress: 65 });
      } else if (shouldSkip("acquire")) {
        log("acquire", `Using stored ${acquired.length} PDFs`, "info");
        setPipeline({ progress: 65 });
      } else {
        log("acquire", "No papers with DOIs available — using abstracts only", "warn");
        setPipeline({ progress: 65 });
      }

      // ── Step 17: PDF Text Extraction ───────────────────────────────────
      let extracted: { path: string; text: string; pages: number }[] = stored.extractedTexts;
      if (!shouldSkip("extract") && acquired.length > 0) {
        log("extract", `Extracting text from ${acquired.length} PDFs...`);
        setPipeline({ phase: "extracting", progress: 68, statusMessage: "Extracting PDF text..." });
        const er = await runPhase("extract", { paths: acquired.map((a) => a.path), ...baseArgs });
        if (abortRef.current) return;
        extracted = Array.isArray(er?.results) ? er.results.filter((r: { ok: boolean }) => r.ok) : [];
        log("extract", `Extracted ${extracted.length}/${acquired.length} documents`, extracted.length > 0 ? "success" : "warn");
        markGood("extract");
        setPipeline({ extractedTexts: extracted, progress: 72 });
      } else if (shouldSkip("extract")) {
        log("extract", `Using stored ${extracted.length} extracts`, "info");
        setPipeline({ progress: 72 });
      } else {
        setPipeline({ progress: 72, statusMessage: "No PDFs — using abstracts" });
      }

      // ── Step 20-21: Vector DB Ingest ───────────────────────────────────
      if (!shouldSkip("ingest") && extracted.length > 0 && !abortRef.current) {
        log("vectordb", "Ingesting into vector database...");
        setPipeline({ phase: "ingesting", progress: 73, statusMessage: "Building vector index..." });
        const projectId = thread?.id || "default";
        const vdbPapers = extracted.map((e, i) => ({
          title: acquired[i]?.title || `Paper ${i + 1}`,
          doi: acquired[i]?.doi || "",
          text: e.text || "",
        }));
        const vr2 = await runPhase("ingest_vectordb", { project_id: projectId, papers: vdbPapers, query: q,
          embedding_model: settings?.embedding_model ?? "allenai/specter2" });
        if (vr2.warning) log("vectordb", vr2.warning, "warn");
        else log("vectordb", `Stored ${vr2.chunks_stored ?? "?"} chunks`, "success");
        markGood("ingest");
      }

      // ── Step 31: Blueprint Architect ───────────────────────────────────
      const papersContext = relevant.slice(0, 20).map((p: PaperResult, i: number) =>
        `[${i + 1}] "${p.title}" (${p.authors?.slice(0, 3).join(", ") || "Unknown"}, ${p.year || "n.d."}). ${p.abstract?.slice(0, 300) || ""}`
      ).join("\n");
      const extractedContext = extracted.slice(0, 10).map((e) => e.text?.slice(0, 2000) || "").filter(Boolean).join("\n---\n");

      let blueprint = stored.blueprint;
      if (!shouldSkip("blueprint") && !abortRef.current) {
        log("blueprint", "Generating paper blueprint and section plan...");
        setPipeline({ phase: "blueprinting", progress: 74, statusMessage: "Generating blueprint..." });
        const br = await runPhase("blueprint", {
          query: q, papers_context: papersContext, extracted_texts: extractedContext,
          step_config: stepConfig("blueprint_agent"), ...baseArgs,
        });
        trackTokens(br);
        if (abortRef.current) return;
        if (br.ok) {
          blueprint = {
            sections: br.sections || [],
            figure_plan: br.figure_plan || [],
            table_plan: br.table_plan || [],
            guidelines_map: br.guidelines_map || {},
          };
          log("blueprint", `Planned ${blueprint.sections.length} sections, ${blueprint.figure_plan.length} figures, ${blueprint.table_plan.length} tables`, "success");
          markGood("blueprint");
          setPipeline({ blueprint, progress: 78 });
        } else {
          log("blueprint", `Blueprint failed: ${br.error || br.reason || "unknown"} — using default sections`, "warn");
          blueprint = null;
          setPipeline({ progress: 78 });
        }
      } else if (shouldSkip("blueprint")) {
        log("blueprint", `Using stored blueprint (${blueprint?.sections.length ?? 0} sections)`, "info");
        setPipeline({ progress: 78 });
      }

      // ── Step 32: Section Drafter (loops) ──────────────────────────────
      const sectionTypes = blueprint?.sections?.length
        ? blueprint.sections.map((s: { id?: string; title: string }) => s.id || s.title.toLowerCase().replace(/\s+/g, "_"))
        : ["introduction", "methodology", "results", "discussion"];
      const sectionTitles = blueprint?.sections?.length
        ? blueprint.sections.map((s: { title: string }) => s.title)
        : ["Introduction", "Methodology", "Results", "Discussion"];

      let draftSections: { type: string; text: string; figures?: string[]; tables?: string[] }[] =
        shouldSkip("draft") ? stored.draftSections : [];

      if (!shouldSkip("draft") && !abortRef.current) {
        const projectId = thread?.id || "default";
        let draftFailed = 0;
        for (let si = 0; si < sectionTypes.length; si++) {
          if (abortRef.current) return;
          const sType = sectionTypes[si];
          const sTitle = sectionTitles[si];
          const pct = 78 + (si / sectionTypes.length) * 10;
          log("draft", `Drafting "${sTitle}"...`);
          setPipeline({ phase: "drafting", progress: Math.round(pct), statusMessage: `Drafting ${sTitle}...` });
          const blueprintReqs = blueprint?.sections?.[si]
            ? `Section: ${blueprint.sections[si].title}\nDescription: ${blueprint.sections[si].description}\nRequirements: ${blueprint.sections[si].requirements}`
            : "";
          try {
            const dr = await runPhase("draft", {
              section_type: sType, query: q,
              papers_context: papersContext, extracted_texts: extractedContext,
              blueprint_requirements: blueprintReqs, project_id: projectId,
              step_config: stepConfig("lead_author"), ...baseArgs,
            });
            trackTokens(dr);
            if (dr.ok && dr.text) {
              draftSections.push({ type: sType, text: dr.text, figures: dr.figures || [], tables: dr.tables || [] });
              log("draft", `"${sTitle}": ${dr.text.length.toLocaleString()} chars drafted`, "success");
            } else {
              draftFailed++;
              log("draft", `"${sTitle}": FAILED — ${dr.error || dr.reason || "empty response from model"}`, "error");
            }
          } catch (e) {
            draftFailed++;
            log("draft", `"${sTitle}": ERROR — ${String(e)}`, "error");
          }
        }

        if (draftSections.length === 0) {
          const errMsg = `All ${sectionTypes.length} sections failed to draft. Check your API key and model in Settings.`;
          log("draft", errMsg, "error");
          setPipeline({ phase: "error", error: errMsg, active: false, failedPhase: "draft", draftSections, progress: 88 });
          return;
        }

        if (draftFailed > 0) {
          log("draft", `${draftFailed} section(s) failed — continuing with ${draftSections.length} sections`, "warn");
        }

        markGood("draft");
        setPipeline({ draftSections, progress: 88 });
      } else if (shouldSkip("draft")) {
        log("draft", `Using stored ${draftSections.length} sections`, "info");
        setPipeline({ progress: 88 });
      }

      // ── Step 33-37: Figures & Tables ───────────────────────────────────
      const figurePlan = blueprint?.figure_plan || [];
      const tablePlan = blueprint?.table_plan || [];
      if (figurePlan.length > 0 || tablePlan.length > 0) {
        if (abortRef.current) return;
        log("figures", `Generating ${figurePlan.length} figures + ${tablePlan.length} tables...`);
        setPipeline({ phase: "generating_figures", progress: 86, statusMessage: "Generating charts & tables..." });
        try {
          const fr = await runPhase("generate_figures", {
            figure_plan: figurePlan, table_plan: tablePlan,
            draft_sections: draftSections, papers_context: papersContext, query: q, ...baseArgs,
          });
          trackTokens(fr);
          if (fr.ok) {
            setPipeline({ generatedFigures: fr.figures || [], generatedTables: fr.tables || [] });
            log("figures", `Generated ${(fr.figures || []).length} figures, ${(fr.tables || []).length} tables`, "success");
            markGood("generate_figures");
          }
        } catch (e) {
          log("figures", `Figure generation error: ${String(e)}`, "error");
        }
      }
      setPipeline({ progress: 88 });

      // ── Step 38-40: Quality Swarm ──────────────────────────────────────
      if (draftSections.length > 0 && !shouldSkip("citation_verify_swarm")) {
        if (abortRef.current) return;
        log("citation_verify", "Running citation verification swarm...");
        setPipeline({ phase: "citation_verifying", progress: 89, statusMessage: "Verifying citations..." });
        try {
          const cv = await runPhase("citation_verify_swarm", {
            sections: draftSections, papers: relevant.slice(0, 30), query: q,
            step_config: stepConfig("citation_verifier"), ...baseArgs,
          });
          trackTokens(cv);
          const citIssues = cv.ok ? (cv.issues || []) : [];
          setPipeline({ citationIssues: citIssues });
          log("citation_verify",
            citIssues.length === 0 ? "All citations verified" : `${citIssues.length} citation issue(s) found`,
            citIssues.length === 0 ? "success" : "warn"
          );
          markGood("citation_verify_swarm");
        } catch (e) {
          log("citation_verify", `Citation verification error: ${String(e)}`, "error");
        }
      }

      if (draftSections.length > 0 && !shouldSkip("guidelines_check")) {
        if (abortRef.current) return;
        log("guidelines", "Checking reporting guidelines compliance...");
        setPipeline({ phase: "guidelines_checking", progress: 91, statusMessage: "Checking guidelines..." });
        try {
          const gc = await runPhase("guidelines_check", {
            sections: draftSections, query: q,
            guidelines_map: blueprint?.guidelines_map || {},
            step_config: stepConfig("guidelines_compliance"), ...baseArgs,
          });
          trackTokens(gc);
          const checklist = gc.ok ? (gc.checklist || []) : [];
          const glIssues = checklist.filter((it: { status: string }) => it.status !== "met");
          setPipeline({ guidelinesIssues: glIssues });
          log("guidelines",
            `${checklist.length - glIssues.length}/${checklist.length} guideline items met`,
            glIssues.length === 0 ? "success" : "warn"
          );
          markGood("guidelines_check");
        } catch (e) {
          log("guidelines", `Guidelines check error: ${String(e)}`, "error");
        }
      }

      // ── Step 42: Prose Smoother ────────────────────────────────────────
      const currentState = useResearchStore.getState().pipeline;
      if (draftSections.length > 0 && !shouldSkip("smooth")) {
        if (abortRef.current) return;
        log("smooth", "Polishing manuscript prose...");
        setPipeline({ phase: "smoothing", progress: 93, statusMessage: "Polishing manuscript..." });
        try {
          const sr = await runPhase("smooth", {
            sections: draftSections, query: q, papers: relevant.slice(0, 30),
            project_id: thread?.id || "default",
            generated_figures: currentState.generatedFigures || [],
            generated_tables: currentState.generatedTables || [],
            citation_issues: currentState.citationIssues,
            guidelines_issues: currentState.guidelinesIssues,
            step_config: stepConfig("smoothing_pass"), ...baseArgs,
          });
          trackTokens(sr);
          if (abortRef.current) return;
          if (sr.ok && sr.manuscript) {
            log("smooth", `Manuscript polished: ${sr.manuscript.length.toLocaleString()} chars`, "success");
            markGood("smooth");
            setPipeline({ manuscript: sr.manuscript, progress: 97 });
          } else {
            log("smooth", `Prose smoother failed: ${sr.error || "empty output"} — using raw draft`, "warn");
            // Fallback: compile raw draft sections
            const fallbackMs = draftSections.map((s) => `## ${s.type.replace(/_/g, " ")}\n\n${s.text}`).join("\n\n---\n\n");
            setPipeline({ manuscript: fallbackMs, progress: 97 });
          }
        } catch (e) {
          log("smooth", `Smoother error: ${String(e)} — using raw draft`, "error");
          const fallbackMs = draftSections.map((s) => `## ${s.type.replace(/_/g, " ")}\n\n${s.text}`).join("\n\n---\n\n");
          setPipeline({ manuscript: fallbackMs, progress: 97 });
        }
      } else if (shouldSkip("smooth") && currentState.manuscript) {
        log("smooth", "Using stored manuscript", "info");
      }

      // ── Step 43: Citation Formatter ────────────────────────────────────
      if (!abortRef.current) {
        log("compile", "Compiling bibliography...");
        setPipeline({ phase: "compiling", progress: 98, statusMessage: "Compiling bibliography..." });
        try {
          const rr = await runPhase("compile_refs", { papers: relevant.slice(0, 30), ...baseArgs });
          if (rr?.ok && rr.bibtex) {
            log("compile", `${rr.count || rr.bibtex.split("@").length - 1} references compiled`, "success");
            markGood("compile_refs");
            setPipeline({ bibliography: rr.bibtex });
          } else {
            log("compile", "No bibliography generated", "warn");
          }
        } catch (e) {
          log("compile", `Bibliography compilation error: ${String(e)}`, "error");
        }
      }

      // ── Auto-rename thread ─────────────────────────────────────────────
      try {
        const ren = await runPhase("auto_rename", {
          content: q, api_key: params.api_key, provider: params.provider, model: "",
        });
        if (ren?.ok && ren.title && thread) renameThread(thread.id, ren.title);
        else if (thread && thread.title === "New Research") renameThread(thread.id, q.slice(0, 60));
      } catch {
        if (thread && thread.title === "New Research") renameThread(thread.id, q.slice(0, 60));
      }

      // ── Store result as chat message ───────────────────────────────────
      const finalState = useResearchStore.getState().pipeline;
      if (thread) {
        addMessage(thread.id, {
          id: `sys-${Date.now()}`, role: "system",
          content: `Pipeline complete: "${q}" — ${allPapers.length} found, ${relevant.length} relevant, ${acquired.length} acquired`,
          type: "text", timestamp: Date.now(),
        });
        if (relevant.length > 0) {
          addMessage(thread.id, {
            id: `tool-${Date.now()}`, role: "tool",
            content: `Found ${allPapers.length} papers, ${relevant.length} relevant, ${acquired.length} full-text`,
            type: "papers", data: relevant.slice(0, 15), timestamp: Date.now(), tool_used: "Pipeline",
          });
        }
      }

      const msLen = finalState.manuscript.length;
      log("complete", `Done! ${allPapers.length} papers found · ${relevant.length} relevant · ${acquired.length} acquired · ${msLen.toLocaleString()} char manuscript`, "success");
      setPipeline({ phase: "complete", progress: 100, active: false, statusMessage: "Complete!" });
      setBottomTab(msLen > 0 ? "manuscript" : "papers");
      onToast("Pipeline complete!");

    } catch (e) {
      const errMsg = String(e);
      log("error", errMsg, "error");
      const failedPhase = useResearchStore.getState().pipeline.lastGoodPhase
        ? phaseAfter(useResearchStore.getState().pipeline.lastGoodPhase!) ?? undefined
        : undefined;
      setPipeline({ phase: "error", error: errMsg, active: false, failedPhase });
      onToast(`Pipeline failed`);
    }
  }, [query, design, params, settings, thread, setPipeline, log, trackTokens, runPhase, addMessage, renameThread, onToast]);

  // ── Retry handlers ────────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    const { query: savedQ, studyDesign: savedD } = useResearchStore.getState().pipeline;
    const q = savedQ || query;
    const d = savedD || design;
    if (!q) { onToast("No previous query to retry"); return; }
    setQuery(q);
    setDesign(d);
    handleRun(q, d, undefined);
  }, [query, design, handleRun, onToast]);

  const handleContinue = useCallback((fromPhase: string) => {
    const { query: savedQ, studyDesign: savedD } = useResearchStore.getState().pipeline;
    const q = savedQ || query;
    const d = savedD || design;
    if (!q) { onToast("No query to continue"); return; }
    handleRun(q, d, fromPhase);
  }, [query, design, handleRun, onToast]);

  const handleStop = useCallback(() => {
    abortRef.current = true;
    setPipeline({ active: false, phase: "error", statusMessage: "Cancelled by user", error: "Cancelled by user" });
  }, [setPipeline]);

  const handleNewResearch = useCallback(() => {
    resetPipeline();
    setQuery("");
    setDesign("systematic_review");
  }, [resetPipeline]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const isIdle = !pipeline.active && pipeline.phase === "idle";
  const isComplete = pipeline.phase === "complete";
  const isError = pipeline.phase === "error";
  const isStopped = !pipeline.active && (isComplete || isError);
  const hasResults = (pipeline.papers?.length ?? 0) > 0 || !!pipeline.manuscript;
  const savedQuery = pipeline.query;

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ fontFamily: t.font.sans }}>
      {isIdle ? (
        /* ── Launch Form ──────────────────────────────────────────────────── */
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <div className="rounded-2xl p-8" style={{ background: t.bg.surface, border: `1px solid ${t.border.default}` }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: t.accent.emeraldDim, border: `1px solid ${t.accent.emeraldBorder}` }}>
                  <i className="fa-solid fa-bolt text-lg" style={{ color: t.accent.emerald }} />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold" style={{ color: t.text.primary }}>Research Pipeline</h2>
                  <p className="text-[11px]" style={{ color: t.text.muted }}>
                    Autonomous search → screen → acquire → draft → verify → polish
                  </p>
                </div>
              </div>

              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleRun(); }}
                placeholder="Enter your research question..."
                className="w-full rounded-xl px-4 py-3 text-[13px] placeholder:opacity-30 outline-none resize-none mb-4 select-text"
                style={{ background: t.bg.elevated, border: `1px solid ${t.border.subtle}`, color: t.text.primary, minHeight: 80 }}
                rows={3}
              />

              <div className="flex items-center gap-3 mb-5">
                <label className="text-[11px] flex-shrink-0" style={{ color: t.text.muted }}>Study design:</label>
                <select
                  value={design}
                  onChange={(e) => setDesign(e.target.value as StudyDesign)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[12px] outline-none appearance-none cursor-pointer"
                  style={{ background: t.bg.elevated, border: `1px solid ${t.border.subtle}`, color: t.text.secondary }}
                >
                  {STUDY_DESIGNS.map((d) => (
                    <option key={d.id} value={d.id} style={{ background: t.bg.surface }}>{d.label}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => handleRun()}
                disabled={!query.trim() || !params.api_key}
                className="w-full py-3 rounded-xl text-[13px] font-semibold transition-all cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(135deg, ${t.accent.emeraldDim}, ${t.accent.cyanDim})`,
                  border: `1px solid ${t.accent.emeraldBorder}`,
                  color: t.accent.emerald,
                }}
              >
                <i className="fa-solid fa-play text-[10px] mr-2" />
                {params.api_key ? "Launch Pipeline" : "Set API Key in Settings First"}
              </button>

              {!params.api_key && (
                <p className="text-[10px] text-center mt-3" style={{ color: t.text.ghost }}>
                  Open Settings (top-right) → API Keys to configure your provider
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── Running / Complete / Error ───────────────────────────────────── */
        <div className="flex-1 flex min-h-0">

          {/* Left: Agent Activity Feed */}
          <div className="w-[300px] border-r flex-shrink-0 flex flex-col" style={{ borderColor: t.border.subtle, background: t.bg.base }}>
            <AgentActivityFeed onRetry={handleRetry} onContinue={handleContinue} />
          </div>

          {/* Right: Results */}
          <div className="flex-1 flex flex-col min-w-0">

            {/* Query banner */}
            <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0"
              style={{ borderColor: t.border.subtle, background: t.bg.surface }}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold flex-shrink-0"
                  style={{ background: t.accent.emeraldDim, color: t.accent.emerald, fontFamily: t.font.mono }}>
                  {pipeline.studyDesign?.replace(/_/g, " ") || "Research"}
                </span>
                <span className="text-[12px] truncate select-text" style={{ color: t.text.secondary }} title={savedQuery}>
                  {savedQuery}
                </span>
              </div>

              {/* Action buttons — no duplicate stop elsewhere */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {pipeline.active && (
                  <button onClick={handleStop}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-all"
                    style={{ color: t.accent.red, background: t.accent.redDim, border: `1px solid ${t.accent.red}30` }}
                  >
                    <i className="fa-solid fa-stop text-[8px]" /> Stop
                  </button>
                )}

                {isStopped && (
                  <>
                    <button onClick={handleRetry}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-all"
                      style={{ color: t.text.muted, background: t.bg.elevated, border: `1px solid ${t.border.subtle}` }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = t.accent.cyan; e.currentTarget.style.borderColor = t.accent.cyanBorder; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = t.text.muted; e.currentTarget.style.borderColor = t.border.subtle; }}
                    >
                      <i className="fa-solid fa-rotate-right text-[8px]" /> Retry
                    </button>
                    <button onClick={() => setViewMode("chat")}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-all"
                      style={{ color: t.accent.cyan, background: t.accent.cyanDim, border: `1px solid ${t.accent.cyanBorder}` }}
                    >
                      <i className="fa-solid fa-comments text-[8px]" /> Chat
                    </button>
                    <button onClick={handleNewResearch}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-all"
                      style={{ color: t.text.ghost, background: t.bg.surface, border: `1px solid ${t.border.subtle}` }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = t.text.muted; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = t.text.ghost; }}
                    >
                      <i className="fa-solid fa-plus text-[8px]" /> New
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Error display */}
            {isError && pipeline.error && (
              <div className="mx-4 mt-3 px-4 py-3 rounded-xl flex-shrink-0"
                style={{ background: t.accent.redDim, border: `1px solid ${t.accent.red}30` }}>
                <div className="flex items-start gap-2">
                  <i className="fa-solid fa-circle-xmark text-[13px] mt-0.5 flex-shrink-0" style={{ color: t.accent.red }} />
                  <div>
                    <div className="text-[11px] font-semibold mb-1" style={{ color: t.accent.red }}>Pipeline Error</div>
                    <div className="text-[11px] leading-relaxed break-words select-text" style={{ color: `${t.accent.red}cc` }}>
                      {pipeline.error}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button onClick={handleRetry}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-medium cursor-pointer"
                        style={{ background: `${t.accent.red}20`, color: t.accent.red, border: `1px solid ${t.accent.red}40` }}
                      >
                        <i className="fa-solid fa-rotate-right text-[8px]" /> Retry from start
                      </button>
                      {pipeline.lastGoodPhase && (
                        <button onClick={() => handleContinue(phaseAfter(pipeline.lastGoodPhase!) ?? pipeline.lastGoodPhase!)}
                          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-medium cursor-pointer"
                          style={{ background: t.accent.amberDim, color: t.accent.amber, border: `1px solid ${t.accent.amber}40` }}
                        >
                          <i className="fa-solid fa-forward-step text-[8px]" /> Continue from checkpoint
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Results tabs */}
            {hasResults && (
              <div className="flex border-b flex-shrink-0" style={{ borderColor: t.border.subtle }}>
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
                      <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{ background: t.bg.elevated, color: t.text.ghost, fontFamily: t.font.mono }}>
                        {tab.count}
                      </span>
                    )}
                    {bottomTab === tab.id && (
                      <div className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: t.accent.cyan }} />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>
              {!hasResults && !isError && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center" style={{ color: t.text.ghost }}>
                    <i className="fa-solid fa-circle-notch fa-spin text-2xl mb-3 block" />
                    <div className="text-[12px]">{pipeline.statusMessage || "Working..."}</div>
                  </div>
                </div>
              )}
              {hasResults && bottomTab === "papers" && (
                <PaperBrowser
                  papers={pipeline.relevantPapers ?? pipeline.papers ?? []}
                  acquiredDois={new Set((pipeline.acquiredPdfs ?? []).map((a) => a.doi))}
                />
              )}
              {hasResults && bottomTab === "manuscript" && (
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
