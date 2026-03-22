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
}

fn default_smart_rename() -> String { "Suggest a clear, descriptive filename for this file. Return ONLY the filename without extension. No explanation.".to_string() }
fn default_smart_sort() -> String { "Categorize these files into logical groups. Return JSON array of objects with 'file' and 'category' keys.".to_string() }
fn default_ocr() -> String { "Extract all text from this image. Return only the extracted text, preserving layout where possible.".to_string() }
fn default_auto_organize() -> String { "You are a file organizer. Given the following files, suggest a clean organization.\nReturn ONLY a JSON array: [{\"old_path\": \"...\", \"new_name\": \"...\", \"folder\": \"...\"}]\n- 'folder' is a category subfolder (e.g. 'Receipts', 'Photos')\n- 'new_name' is a descriptive filename (keep extension)".to_string() }
fn default_translate() -> String { "Translate the following text accurately. Return ONLY the translated text, preserving formatting.".to_string() }
fn default_ask_data() -> String { "Answer the question based ONLY on the provided document chunks. Cite which chunk(s) support your answer.".to_string() }
fn default_summarize() -> String { "Provide a summary of the following document. Start with a single TL;DR sentence, then provide a detailed summary with key points.".to_string() }
fn default_super_summary() -> String { "Create an executive summary combining these document summaries. Start with a TL;DR paragraph. Use citations like [Doc 1] to reference sources.".to_string() }
fn default_dashboard() -> String { "Generate a self-contained HTML dashboard with Chart.js CDN, dark theme, search/filter bar, 2-3 charts, sortable table, and Export PNG button.".to_string() }

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
}

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
