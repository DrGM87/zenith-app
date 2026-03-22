use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

use crate::{ScriptWindowContent, StagedItem};

pub struct ApiServer;

impl ApiServer {
    pub fn start(
        staged_items: Arc<Mutex<HashMap<String, StagedItem>>>,
        script_content: Arc<Mutex<Option<ScriptWindowContent>>>,
        script_events: Arc<Mutex<Vec<serde_json::Value>>>,
        app_handle: tauri::AppHandle,
    ) {
        std::thread::spawn(move || {
            let listener = match TcpListener::bind("127.0.0.1:7890") {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("[Zenith API] Failed to bind port 7890: {}", e);
                    return;
                }
            };
            println!("[Zenith API] Listening on http://127.0.0.1:7890");

            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let items = staged_items.clone();
                let sc = script_content.clone();
                let ev = script_events.clone();
                let app = app_handle.clone();

                std::thread::spawn(move || {
                    let mut reader = BufReader::new(stream.try_clone().unwrap());

                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).is_err() {
                        return;
                    }

                    let parts: Vec<&str> = request_line.trim().split(' ').collect();
                    if parts.len() < 2 {
                        return;
                    }
                    let method = parts[0];
                    let path = parts[1];

                    let mut content_length: usize = 0;
                    loop {
                        let mut header = String::new();
                        if reader.read_line(&mut header).is_err() {
                            break;
                        }
                        let header = header.trim().to_string();
                        if header.is_empty() {
                            break;
                        }
                        if header.to_lowercase().starts_with("content-length:") {
                            if let Some(val) = header.split(':').nth(1) {
                                content_length = val.trim().parse().unwrap_or(0);
                            }
                        }
                    }

                    let body = if content_length > 0 {
                        let mut buf = vec![0u8; content_length];
                        reader.read_exact(&mut buf).ok();
                        String::from_utf8_lossy(&buf).to_string()
                    } else {
                        String::new()
                    };

                    let (status, response_body) =
                        handle_request(method, path, &body, &items, &sc, &ev, &app);

                    let response = format!(
                        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, DELETE, PUT, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\n\r\n{}",
                        status,
                        response_body.len(),
                        response_body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                });
            }
        });
    }
}

use std::io::Read;

fn handle_request(
    method: &str,
    path: &str,
    body: &str,
    items: &Arc<Mutex<HashMap<String, StagedItem>>>,
    script_content: &Arc<Mutex<Option<ScriptWindowContent>>>,
    script_events: &Arc<Mutex<Vec<serde_json::Value>>>,
    app: &tauri::AppHandle,
) -> (&'static str, String) {
    if method == "OPTIONS" {
        return ("204 No Content", String::new());
    }

    match (method, path) {
        ("GET", "/items") => {
            let lock = items.lock().unwrap();
            let list: Vec<&StagedItem> = lock.values().collect();
            let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string());
            ("200 OK", json)
        }

        ("POST", "/stage/file") => {
            #[derive(serde::Deserialize)]
            struct Req {
                path: String,
            }
            match serde_json::from_str::<Req>(body) {
                Ok(req) => {
                    let pb = std::path::PathBuf::from(&req.path);
                    if !pb.exists() {
                        return (
                            "404 Not Found",
                            r#"{"error":"File not found"}"#.to_string(),
                        );
                    }
                    match crate::create_staged_item_from_path(&req.path) {
                        Ok(item) => {
                            let id = item.id.clone();
                            items.lock().unwrap().insert(id, item.clone());
                            let json = serde_json::to_string(&item).unwrap();
                            ("200 OK", json)
                        }
                        Err(e) => ("500 Internal Server Error", format!(r#"{{"error":"{}"}}"#, e)),
                    }
                }
                Err(e) => (
                    "400 Bad Request",
                    format!(r#"{{"error":"Invalid JSON: {}"}}"#, e),
                ),
            }
        }

        ("POST", "/stage/text") => {
            #[derive(serde::Deserialize)]
            struct Req {
                text: String,
            }
            match serde_json::from_str::<Req>(body) {
                Ok(req) => {
                    let id = format!("text-{}", uuid_v4());
                    let item = StagedItem {
                        id: id.clone(),
                        path: String::new(),
                        name: if req.text.len() > 40 {
                            format!("{}...", &req.text[..40])
                        } else {
                            req.text.clone()
                        },
                        size: req.text.len() as u64,
                        extension: "txt".to_string(),
                        is_directory: false,
                        thumbnail: None,
                        mime_type: "text/plain".to_string(),
                        self_destruct_at: None,
                    };
                    items.lock().unwrap().insert(id, item.clone());
                    let json = serde_json::to_string(&item).unwrap();
                    ("200 OK", json)
                }
                Err(e) => (
                    "400 Bad Request",
                    format!(r#"{{"error":"Invalid JSON: {}"}}"#, e),
                ),
            }
        }

        ("DELETE", "/items") => {
            let mut lock = items.lock().unwrap();
            lock.clear();
            crate::persist_items(&lock);
            ("200 OK", r#"{"status":"cleared"}"#.to_string())
        }

        _ if method == "DELETE" && path.starts_with("/items/") => {
            let item_id = urldecode(&path[7..]);
            let mut lock = items.lock().unwrap();
            if lock.remove(&item_id).is_some() {
                crate::persist_items(&lock);
                ("200 OK", r#"{"status":"removed"}"#.to_string())
            } else {
                ("404 Not Found", r#"{"error":"Item not found"}"#.to_string())
            }
        }

        ("POST", "/process") => {
            #[derive(serde::Deserialize)]
            struct Req { action: String, args: serde_json::Value }
            match serde_json::from_str::<Req>(body) {
                Ok(req) => {
                    let args_str = serde_json::to_string(&req.args).unwrap_or_else(|_| "{}".to_string());
                    let resource = app.path().resource_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
                    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
                    let sp1 = resource.join("scripts/process_files.py");
                    let sp2 = cwd.join("scripts/process_files.py");
                    let script: Option<std::path::PathBuf> = if sp1.exists() { Some(sp1) } else if sp2.exists() { Some(sp2) } else { None };
                    if script.is_none() {
                        return ("500 Internal Server Error", r#"{"error":"process_files.py not found"}"#.to_string());
                    }
                    let sp = script.unwrap();
                    let cmd_result = std::process::Command::new("python")
                        .arg("-u").arg(&sp).arg(&req.action).arg(&args_str)
                        .stdout(std::process::Stdio::piped())
                        .stderr(std::process::Stdio::piped())
                        .output();
                    match cmd_result {
                        Ok(out) => {
                            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                            if stdout.is_empty() {
                                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                                let msg = serde_json::json!({"error": stderr}).to_string();
                                ("500 Internal Server Error", msg)
                            } else {
                                ("200 OK", stdout)
                            }
                        }
                        Err(e) => {
                            let msg = serde_json::json!({"error": e.to_string()}).to_string();
                            ("500 Internal Server Error", msg)
                        }
                    }
                }
                Err(e) => {
                    let msg = serde_json::json!({"error": format!("Invalid JSON: {}", e)}).to_string();
                    ("400 Bad Request", msg)
                }
            }
        }

        ("GET", "/settings") => {
            let s = crate::settings::ZenithSettings::load();
            let json = serde_json::to_string(&s).unwrap_or_else(|_| "{}".to_string());
            ("200 OK", json)
        }

        ("PUT", "/settings") => {
            match serde_json::from_str::<crate::settings::ZenithSettings>(body) {
                Ok(new_settings) => {
                    let _ = new_settings.save();
                    ("200 OK", r#"{"status":"saved"}"#.to_string())
                }
                Err(e) => ("400 Bad Request", format!(r#"{{"error":"Invalid JSON: {}"}}"#, e)),
            }
        }

        _ if method == "POST" && path.starts_with("/items/") && path.ends_with("/self-destruct") => {
            let item_id = urldecode(&path[7..path.len()-15]);
            #[derive(serde::Deserialize)]
            struct Req { destruct_at: Option<u64> }
            match serde_json::from_str::<Req>(body) {
                Ok(req) => {
                    let mut lock = items.lock().unwrap();
                    if let Some(item) = lock.get_mut(&item_id) {
                        item.self_destruct_at = req.destruct_at;
                        crate::persist_items(&lock);
                        ("200 OK", r#"{"status":"ok"}"#.to_string())
                    } else {
                        ("404 Not Found", r#"{"error":"Item not found"}"#.to_string())
                    }
                }
                Err(e) => ("400 Bad Request", format!(r#"{{"error":"Invalid JSON: {}"}}"#, e)),
            }
        }

        ("GET", "/health") => ("200 OK", r#"{"status":"ok","app":"zenith","version":"4.0"}"#.to_string()),

        _ if method == "GET" && path.starts_with("/browse/") => {
            let item_id = &path[8..]; // after "/browse/"
            let item_id_decoded = urldecode(item_id);
            let lock = items.lock().unwrap();
            if let Some(item) = lock.get(&item_id_decoded) {
                if item.is_directory {
                    let children = browse_directory(&item.path);
                    let json = serde_json::to_string(&children).unwrap_or_else(|_| "[]".to_string());
                    ("200 OK", json)
                } else {
                    ("400 Bad Request", r#"{"error":"Item is not a directory"}"#.to_string())
                }
            } else {
                ("404 Not Found", r#"{"error":"Item not found"}"#.to_string())
            }
        }

        ("POST", "/window/open") => {
            match serde_json::from_str::<ScriptWindowContent>(body) {
                Ok(content) => {
                    let mut lock = script_content.lock().unwrap();
                    *lock = Some(content);
                    drop(lock);
                    let _ = app.emit("script-window-open", ());
                    ("200 OK", r#"{"status":"ok","action":"window_open"}"#.to_string())
                }
                Err(e) => (
                    "400 Bad Request",
                    format!(r#"{{"error":"Invalid JSON: {}"}}"#, e),
                ),
            }
        }

        ("POST", "/window/update") => {
            match serde_json::from_str::<ScriptWindowContent>(body) {
                Ok(content) => {
                    let mut lock = script_content.lock().unwrap();
                    *lock = Some(content);
                    drop(lock);
                    let _ = app.emit("script-window-update", ());
                    ("200 OK", r#"{"status":"ok","action":"content_updated"}"#.to_string())
                }
                Err(e) => (
                    "400 Bad Request",
                    format!(r#"{{"error":"Invalid JSON: {}"}}"#, e),
                ),
            }
        }

        ("DELETE", "/window") => {
            let mut lock = script_content.lock().unwrap();
            *lock = None;
            drop(lock);
            let _ = app.emit("script-window-close", ());
            ("200 OK", r#"{"status":"closed"}"#.to_string())
        }

        ("GET", "/window/content") => {
            let lock = script_content.lock().unwrap();
            match &*lock {
                Some(content) => {
                    let json = serde_json::to_string(content).unwrap_or_else(|_| "null".to_string());
                    ("200 OK", json)
                }
                None => ("200 OK", "null".to_string()),
            }
        }

        ("POST", "/window/event") => {
            match serde_json::from_str::<serde_json::Value>(body) {
                Ok(event) => {
                    let mut lock = script_events.lock().unwrap();
                    lock.push(event);
                    ("200 OK", r#"{"status":"ok"}"#.to_string())
                }
                Err(e) => (
                    "400 Bad Request",
                    format!(r#"{{"error":"Invalid JSON: {}"}}"#, e),
                ),
            }
        }

        ("GET", "/window/events") => {
            let mut lock = script_events.lock().unwrap();
            let events: Vec<serde_json::Value> = lock.drain(..).collect();
            let json = serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string());
            ("200 OK", json)
        }

        ("POST", "/browse") => {
            #[derive(serde::Deserialize)]
            struct Req {
                path: String,
            }
            match serde_json::from_str::<Req>(body) {
                Ok(req) => {
                    let pb = std::path::PathBuf::from(&req.path);
                    if !pb.exists() {
                        return ("404 Not Found", r#"{"error":"Path not found"}"#.to_string());
                    }
                    if !pb.is_dir() {
                        return ("400 Bad Request", r#"{"error":"Path is not a directory"}"#.to_string());
                    }
                    let children = browse_directory(&req.path);
                    let json = serde_json::to_string(&children).unwrap_or_else(|_| "[]".to_string());
                    ("200 OK", json)
                }
                Err(e) => (
                    "400 Bad Request",
                    format!(r#"{{"error":"Invalid JSON: {}"}}"#, e),
                ),
            }
        }

        _ => (
            "404 Not Found",
            r#"{"error":"Unknown endpoint"}"#.to_string(),
        ),
    }
}

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    size: u64,
    extension: String,
    is_directory: bool,
    mime_type: String,
    children_count: Option<usize>,
}

fn browse_directory(dir_path: &str) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    let Ok(read_dir) = std::fs::read_dir(dir_path) else {
        return entries;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let meta = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let extension = path.extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        let is_dir = meta.is_dir();
        let mime_type = if is_dir {
            "inode/directory".to_string()
        } else {
            crate::get_mime_type(&extension).to_string()
        };
        let children_count = if is_dir {
            std::fs::read_dir(&path).ok().map(|rd| rd.count())
        } else {
            None
        };
        entries.push(FileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            size: meta.len(),
            extension,
            is_directory: is_dir,
            mime_type,
            children_count,
        });
    }
    entries.sort_by(|a, b| {
        b.is_directory.cmp(&a.is_directory).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

fn urldecode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            }
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}-{:x}", t, rand_u32())
}

fn rand_u32() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    seed.wrapping_mul(2654435761)
}
