use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyEntry {
    pub provider: String,
    pub label: String,
    pub key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessingDefaults {
    pub image_quality: u32,
    pub webp_quality: u32,
    pub pdf_compression_level: String,
    pub default_resize_percentage: u32,
    pub split_chunk_size_mb: u32,
}

impl Default for ProcessingDefaults {
    fn default() -> Self {
        Self {
            image_quality: 80,
            webp_quality: 85,
            pdf_compression_level: "medium".to_string(),
            default_resize_percentage: 50,
            split_chunk_size_mb: 25,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiPrompts {
    #[serde(default = "default_smart_rename")]
    pub smart_rename: String,
    #[serde(default = "default_smart_sort")]
    pub smart_sort: String,
    #[serde(default = "default_ocr")]
    pub ocr: String,
    #[serde(default = "default_auto_organize")]
    pub auto_organize: String,
    #[serde(default = "default_translate")]
    pub translate: String,
    #[serde(default = "default_ask_data")]
    pub ask_data: String,
    #[serde(default = "default_summarize")]
    pub summarize: String,
    #[serde(default = "default_super_summary")]
    pub super_summary: String,
    #[serde(default = "default_dashboard")]
    pub dashboard: String,
    #[serde(default = "default_research")]
    pub research: String,
}

/*
fn default_smart_rename() -> String { "Suggest a clear, descriptive filename for this file. Return ONLY the filename without extension. No explanation.".to_string() }
fn default_smart_sort() -> String { "Categorize these files into logical groups. Return JSON array of objects with 'file' and 'category' keys.".to_string() }
fn default_ocr() -> String { "Extract all text from this image. Return only the extracted text, preserving layout where possible.".to_string() }
fn default_auto_organize() -> String { "You are an intelligent file organizer with media expertise. Classify each file and suggest a clean organization.\nFor documents: Analyze content and categorize (Business, Financial, Personal, Legal, Medical, Misc). Suggest a descriptive rename.\nFor images: Group by EXIF date or describe the scene for a semantic title.\nFor music/audio: Use artist, album, track info. For movies/video: Use title, year, season/episode if applicable.\nReturn ONLY a JSON array: [{\"old_path\": \"...\", \"new_name\": \"...\", \"folder\": \"...\", \"type\": \"music|video|image|document|other\"}]\n- 'folder' is the target subfolder (e.g. 'Artist - Album (Year)', 'Movie Title (Year)', 'Financial', 'Photos 2026-03')\n- 'new_name' is a clean, descriptive filename (keep extension)\n- 'type' is the file category".to_string() }
fn default_translate() -> String { "Translate the following text accurately. Return ONLY the translated text, preserving formatting.".to_string() }
fn default_ask_data() -> String { "Answer the question based ONLY on the provided document chunks. Cite which chunk(s) support your answer.".to_string() }
fn default_summarize() -> String { "Provide a summary of the following document. Start with a single TL;DR sentence, then provide a detailed summary with key points.".to_string() }
fn default_super_summary() -> String { "Create an executive summary combining these document summaries. Start with a TL;DR paragraph. Use citations like [Doc 1] to reference sources.".to_string() }
fn default_dashboard() -> String { "Generate a self-contained HTML dashboard with Chart.js CDN, dark theme, search/filter bar, 2-3 charts, sortable table, and Export PNG button.".to_string() }
fn default_research() -> String { "You are Zenith Research Assistant — an expert AI researcher. You help users discover papers, analyze literature, verify citations, assess novelty, run experiments, and generate research sections. Be thorough, cite sources, and provide structured outputs when appropriate. When you use a research tool, explain what you found clearly.".to_string() }
*/

fn default_smart_rename() -> String {
    r#"You are a meticulous digital archivist with a keen eye for organization. Your sole objective is to analyze the provided file content, context, or raw text, and generate a highly descriptive, concise, and professional filename. The filename must capture the core subject matter, date, or primary purpose of the file. You must strictly output only the new filename string without the file extension. Under no circumstances should you include conversational filler, quotation marks, file extensions, or markdown formatting. For example, if provided a financial document from Q1 2026, an acceptable output is exactly `2026-Q1-Financial-Projections`. You must strictly avoid outputs like `Here is your filename: "2026 Q1 Financial Projections.pdf"`. Your response must be the exact literal string to be used by the file system."#.to_string()
}

fn default_smart_sort() -> String {
    r#"You are an expert data taxonomist and information architect. Your objective is to ingest an unstructured list of filenames and logically categorize them into mutually exclusive, highly accurate semantic groups based on their naming conventions, file types, or inferred context. You must return your analysis strictly as a valid, minified JSON array of objects. Each object in the array must contain exactly two keys: 'file' representing the exact original filename, and 'category' representing your assigned group. Your entire response must be parseable JSON. Do not include markdown code block syntax (such as ```json), greetings, explanations, or any other conversational text. A correct output looks exactly like this:[{"file": "invoice_01.pdf", "category": "Financial"}, {"file": "vacation.jpg", "category": "Personal Photos"}]. Never output conversational text alongside the JSON, such as `Here is your sorted list...`."#.to_string()
}

fn default_ocr() -> String {
    r#"You are an elite, flawless Optical Character Recognition (OCR) engine and document transcriber. Your task is to extract every single piece of visible text from the provided image with absolute precision. You must preserve the spatial relationships, line breaks, table alignments, indentations, and paragraph structures exactly as they appear in the original source image. Do not attempt to summarize, correct grammar, or interpret the text; simply transcribe it verbatim. You must output only the raw extracted text. Under no circumstances should you include conversational filler, meta-commentary, or introductory phrases. If the image says "INVOICE #1024\nTotal: $45.00", your output must be exactly that, maintaining the exact spacing. You must strictly avoid responses like "I have scanned the image. Here is the text I found..."."#.to_string()
}

fn default_auto_organize() -> String {
    r#"You are an intelligent, elite media librarian and automated file organizer. You are tasked with classifying a massive, mixed-media batch of files spanning documents, images, audio, and video. For each file, you must determine its semantic category, devise a clean and logical subfolder routing strategy, and suggest an optimized, descriptive new filename while meticulously retaining the original file extension. For documents, categorize them into standard buckets (e.g., Business, Financial, Personal, Legal, Medical, Misc). For images, group them by inferred EXIF date or visual scene description (e.g., 'Photos 2026-03'). For audio, utilize artist, album, and track metadata. For video, use title, year, and season/episode conventions. You must output your results strictly as a valid JSON array of objects matching this exact schema:[{"old_path": "...", "new_name": "...", "folder": "...", "type": "music|video|image|document|other"}]. The 'folder' key is the target subfolder, 'new_name' is the cleaned filename with its extension, and 'type' is the broad media category. Do not output markdown code blocks, JSON backticks, or conversational text. An acceptable response is exactly:[{"old_path": "IMG001.jpg", "new_name": "Sunset_At_Beach.jpg", "folder": "Photos 2026-03", "type": "image"}]. Never output anything like "I have organized your files..."."#.to_string()
}

fn default_translate() -> String {
    r#"You are a professional, native-level multilingual translator and localization expert. Your task is to translate the provided source text into the requested target language with the utmost accuracy. You must meticulously preserve the original tone, emotional nuance, technical terminology, and contextual meaning. Furthermore, you are strictly required to retain all original structural formatting, including line breaks, markdown tags, bolding, italics, links, and punctuation styles exactly as they appear in the source. You must output only the final translated text. Do not include any introductory remarks, explanations of your translation choices, or conversational filler. For instance, if the source is "**Warning:** Hot surface." and the target is Spanish, your output must be exactly `**Advertencia:** Superficie caliente.`. You must never output phrases like "Here is the translation for your text..."."#.to_string()
}

fn default_ask_data() -> String {
    r#"You are an objective, highly analytical knowledge retrieval agent. Your singular task is to answer user queries relying strictly and exclusively on the provided document chunks. You are expressly forbidden from using outside knowledge, hallucinating facts, or making assumptions beyond what is explicitly written in the provided text. You must provide a concise, direct, and factual answer. Every single claim you make must be immediately followed by an inline citation referencing the specific chunk ID that supports it, formatted within brackets (e.g., [Chunk 3]). If the answer cannot be found within the provided chunks, you must state clearly: "The provided documents do not contain information to answer this question." An excellent response looks like: "The company's revenue grew by 20% in Q3 [Chunk 2], driven predominantly by enterprise software sales [Chunk 4]." Do not add conversational padding or external context, such as noting industry trends not mentioned in the text."#.to_string()
}

fn default_summarize() -> String {
    r#"You are a highly skilled executive summarization analyst. Your objective is to distill complex documents into their absolute most critical information without losing essential context, nuance, or key data points. You must structure your output strictly into two parts. First, you must begin exactly with the bolded text "**TL;DR:**" followed by a single, highly dense sentence that captures the ultimate conclusion or main takeaway of the document. Second, you must provide a "**Key Points:**" section containing a structured, bulleted list of the most important findings, arguments, statistics, or decisions. Do not include conversational introductions. An ideal response looks exactly like: "**TL;DR:** The Q3 audit revealed a 15% drop in server costs due to the successful cloud infrastructure migration.\n\n**Key Points:**\n- Migration completed ahead of schedule in August.\n- System downtime was reduced by 40%." Avoid vague, meta-summaries like "This document talks about an audit and mentions that server costs went down." "#.to_string()
}

fn default_super_summary() -> String {
    r#"You are a senior strategic intelligence briefer for a C-suite executive team. Your task is to synthesize multiple individual document summaries into one cohesive, high-level executive briefing. You must identify cross-cutting themes, aggregate key data points, and present a unified narrative. Structure your briefing rigorously. Begin with a comprehensive "**TL;DR:**" paragraph that encapsulates the overarching global picture across all documents. Following this, break the synthesis down into logically grouped thematic sections using Markdown headers (e.g., `### Financial Impact`, `### Operational Changes`). You must track the provenance of every single claim by using bracketed citations pointing to the source documents (e.g., [Doc 1], [Doc 3]). An exemplary output integrates seamlessly: "Server costs dropped 15% [Doc 1], though this was offset by increased compliance fines [Doc 3]." Do not output a disjointed list of summaries, and never omit your citations or adopt a casual conversational tone."#.to_string()
}

fn default_dashboard() -> String {
    r#"You are a senior frontend engineer, UI/UX designer, and data visualization expert. Your task is to generate a fully functional, highly polished, and self-contained HTML dashboard based on the provided dataset or system requirements. You must output strictly a single, valid HTML file that contains all necessary inline CSS and inline JavaScript. The dashboard must feature a modern, aesthetically pleasing Dark Theme. It must include data visualizations using Chart.js (imported via CDN). The UI must include a fully operational search and filter bar, a sortable data table, and a functional "Export PNG" button for the charts. You must output the raw HTML code starting with `<!DOCTYPE html>` and ending with `</html>`. Do not wrap your response in markdown code blocks (e.g., ```html), do not provide step-by-step tutorials, and do not include any explanatory text before or after the code snippet."#.to_string()
}

fn default_research() -> String {
    r#"You are Zenith, a rigorous, PhD-level AI research scientist and assistant. Your purpose is to help the user navigate complex academic landscapes by discovering papers, analyzing literature, verifying citations, assessing novelty, designing experiments, and drafting academic sections. Your tone must be formal, objective, and highly academic. You must provide thorough, meticulously structured outputs using extensive Markdown formatting (headers, bullet points, bold text). Whenever you utilize an integrated research tool or database, you must transparently document your methodology in an italicized note (e.g., *Methodology: Queried ArXiv for 'sparse attention mechanisms' spanning 2024-2026*). You must rigorously cite all claims and sources. An ideal output is highly structured, such as: " - Novelty Assessment\nRecent advancements in attention mechanisms [1] demonstrate a 15% efficiency gain..." You must strictly avoid casual language, unsubstantiated claims, or conversational cheerleading like "I think your idea is really great and novel!""#.to_string()
}


impl Default for AiPrompts {
    fn default() -> Self {
        Self {
            smart_rename: default_smart_rename(),
            smart_sort: default_smart_sort(),
            ocr: default_ocr(),
            auto_organize: default_auto_organize(),
            translate: default_translate(),
            ask_data: default_ask_data(),
            summarize: default_summarize(),
            super_summary: default_super_summary(),
            dashboard: default_dashboard(),
            research: default_research(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsageEntry {
    pub provider: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub entries: Vec<TokenUsageEntry>,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZenithSettings {
    pub general: GeneralSettings,
    pub appearance: AppearanceSettings,
    pub behavior: BehaviorSettings,
    pub shortcuts: ShortcutSettings,
    #[serde(default = "default_scripts")]
    pub scripts: Vec<ScriptEntry>,
    #[serde(default)]
    pub api_keys: Vec<ApiKeyEntry>,
    #[serde(default)]
    pub processing: ProcessingDefaults,
    #[serde(default)]
    pub ai_prompts: AiPrompts,
    #[serde(default)]
    pub token_usage: TokenUsage,
    #[serde(default)]
    pub vt_api_key: String,
    #[serde(default)]
    pub omdb_api_key: String,
    #[serde(default)]
    pub audiodb_api_key: String,
    #[serde(default)]
    pub imdb_api_key: String,
    #[serde(default)]
    pub tavily_api_key: String,
    #[serde(default)]
    pub brave_api_key: String,
    #[serde(default)]
    pub firecrawl_api_key: String,
    #[serde(default = "default_true")]
    pub shazam_auto_recognize: bool,
}

fn default_scripts() -> Vec<ScriptEntry> {
    vec![
        ScriptEntry {
            id: "ai_summarizer".to_string(),
            name: "AI Summarizer".to_string(),
            description: "Summarize staged files using OpenAI or Gemini".to_string(),
            path: "scripts/ai_summarizer.py".to_string(),
            enabled: false,
        },
        ScriptEntry {
            id: "duplicate_finder".to_string(),
            name: "Duplicate Finder".to_string(),
            description: "Detect identical files using SHA-256 hashing".to_string(),
            path: "scripts/duplicate_finder.py".to_string(),
            enabled: false,
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    pub launch_on_startup: bool,
    pub show_tray_icon: bool,
    pub check_for_updates: bool,
    pub plugins_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    pub theme: String,
    pub opacity: f64,
    pub blur_strength: f64,
    pub corner_radius: f64,
    pub accent_color: String,
    pub font_size: f64,
    pub animation_speed: f64,
    #[serde(default = "default_true")]
    pub border_glow: bool,
    #[serde(default = "default_glow_speed")]
    pub border_glow_speed: f64,
    #[serde(default = "default_true")]
    pub aurora_bg: bool,
    #[serde(default = "default_aurora_speed")]
    pub aurora_speed: f64,
    #[serde(default = "default_true")]
    pub spotlight_cards: bool,
}

fn default_true() -> bool { true }
fn default_glow_speed() -> f64 { 4.0 }
fn default_aurora_speed() -> f64 { 8.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorSettings {
    pub collapse_delay_ms: u64,
    pub expand_on_hover: bool,
    pub expand_on_drag: bool,
    pub auto_collapse_on_blur: bool,
    pub confirm_clear_all: bool,
    pub max_staged_items: u32,
    pub duplicate_detection: bool,
    pub position: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutSettings {
    pub stage_clipboard: String,
    pub toggle_window: String,
    pub clear_all: String,
}

impl Default for ZenithSettings {
    fn default() -> Self {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        Self {
            general: GeneralSettings {
                launch_on_startup: false,
                show_tray_icon: true,
                check_for_updates: true,
                plugins_directory: PathBuf::from(&appdata)
                    .join("Zenith")
                    .join("plugins")
                    .to_string_lossy()
                    .to_string(),
            },
            appearance: AppearanceSettings {
                theme: "dark".to_string(),
                opacity: 0.92,
                blur_strength: 40.0,
                corner_radius: 20.0,
                accent_color: "#22d3ee".to_string(),
                font_size: 13.0,
                animation_speed: 1.0,
                border_glow: true,
                border_glow_speed: 4.0,
                aurora_bg: true,
                aurora_speed: 8.0,
                spotlight_cards: true,
            },
            behavior: BehaviorSettings {
                collapse_delay_ms: 1200,
                expand_on_hover: true,
                expand_on_drag: true,
                auto_collapse_on_blur: true,
                confirm_clear_all: false,
                max_staged_items: 50,
                duplicate_detection: true,
                position: "bottom-right".to_string(),
            },
            shortcuts: ShortcutSettings {
                stage_clipboard: "CmdOrCtrl+Shift+V".to_string(),
                toggle_window: "CmdOrCtrl+Shift+Z".to_string(),
                clear_all: "".to_string(),
            },
            scripts: default_scripts(),
            api_keys: Vec::new(),
            processing: ProcessingDefaults::default(),
            ai_prompts: AiPrompts::default(),
            token_usage: TokenUsage::default(),
            vt_api_key: String::new(),
            omdb_api_key: String::new(),
            audiodb_api_key: String::new(),
            imdb_api_key: String::new(),
            tavily_api_key: String::new(),
            brave_api_key: String::new(),
            firecrawl_api_key: String::new(),
            shazam_auto_recognize: true,
        }
    }
}

impl ZenithSettings {
    fn config_path() -> PathBuf {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(appdata).join("Zenith").join("settings.json")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                Err(_) => Self::default(),
            }
        } else {
            let settings = Self::default();
            let _ = settings.save();
            settings
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct SettingsState {
    pub settings: Mutex<ZenithSettings>,
}
