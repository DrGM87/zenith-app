use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use wasmtime::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub path: String,
    pub loaded: bool,
}

pub struct PluginManager {
    engine: Engine,
    plugins_dir: PathBuf,
}

impl PluginManager {
    pub fn new() -> Result<Self, String> {
        let engine = Engine::default();

        let plugins_dir = dirs_plugin_path();
        if !plugins_dir.exists() {
            fs::create_dir_all(&plugins_dir).map_err(|e| e.to_string())?;
        }

        Ok(Self {
            engine,
            plugins_dir,
        })
    }

    pub fn list_plugins(&self) -> Result<Vec<PluginInfo>, String> {
        let mut plugins = Vec::new();

        if !self.plugins_dir.exists() {
            return Ok(plugins);
        }

        let entries = fs::read_dir(&self.plugins_dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("wasm") {
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();

                plugins.push(PluginInfo {
                    name,
                    path: path.to_string_lossy().to_string(),
                    loaded: true,
                });
            }
        }

        Ok(plugins)
    }

    pub fn run_plugin(
        &self,
        plugin_path: &str,
        staged_items_json: &str,
    ) -> Result<String, String> {
        let wasm_bytes = fs::read(plugin_path).map_err(|e| format!("Read error: {}", e))?;

        let module =
            Module::new(&self.engine, &wasm_bytes).map_err(|e| format!("Module error: {}", e))?;

        let mut store = Store::new(&self.engine, PluginState {
            items_json: staged_items_json.to_string(),
            output: String::new(),
        });

        let mut linker = Linker::new(&self.engine);

        linker
            .func_wrap(
                "zenith",
                "get_items_len",
                |caller: Caller<'_, PluginState>| -> i32 {
                    caller.data().items_json.len() as i32
                },
            )
            .map_err(|e| format!("Linker error: {}", e))?;

        linker
            .func_wrap(
                "zenith",
                "get_items_ptr",
                |mut caller: Caller<'_, PluginState>, ptr: i32, max_len: i32| -> i32 {
                    let json = caller.data().items_json.clone();
                    let bytes = json.as_bytes();
                    let write_len = bytes.len().min(max_len as usize);

                    if let Some(memory) = caller.get_export("memory") {
                        if let Some(mem) = memory.into_memory() {
                            let data = mem.data_mut(&mut caller);
                            let offset = ptr as usize;
                            if offset + write_len <= data.len() {
                                data[offset..offset + write_len]
                                    .copy_from_slice(&bytes[..write_len]);
                                return write_len as i32;
                            }
                        }
                    }
                    -1
                },
            )
            .map_err(|e| format!("Linker error: {}", e))?;

        linker
            .func_wrap(
                "zenith",
                "set_output",
                |mut caller: Caller<'_, PluginState>, ptr: i32, len: i32| {
                    if let Some(memory) = caller.get_export("memory") {
                        if let Some(mem) = memory.into_memory() {
                            let data = mem.data(&caller);
                            let offset = ptr as usize;
                            let length = len as usize;
                            if offset + length <= data.len() {
                                if let Ok(s) = std::str::from_utf8(&data[offset..offset + length]) {
                                    caller.data_mut().output = s.to_string();
                                }
                            }
                        }
                    }
                },
            )
            .map_err(|e| format!("Linker error: {}", e))?;

        let instance = linker
            .instantiate(&mut store, &module)
            .map_err(|e| format!("Instantiate error: {}", e))?;

        let run_fn = instance
            .get_typed_func::<(), ()>(&mut store, "run")
            .map_err(|e| format!("Missing 'run' export: {}", e))?;

        run_fn
            .call(&mut store, ())
            .map_err(|e| format!("Execution error: {}", e))?;

        Ok(store.data().output.clone())
    }
}

struct PluginState {
    items_json: String,
    output: String,
}

fn dirs_plugin_path() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(appdata).join("Zenith").join("plugins")
}
