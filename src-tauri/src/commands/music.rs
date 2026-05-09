use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::commands::staging::{chrono_id, create_staged_item_from_path};

fn dirs_path() -> Option<PathBuf> {
    std::env::var("USERPROFILE").ok().map(PathBuf::from)
}

fn music_discovery_path() -> PathBuf {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(local).join("Zenith").join("music_discovery.json")
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct MusicTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub year: String,
    pub genre: String,
    pub cover_url: String,
    pub shazam_url: String,
    pub discovered_at: u64,
    pub note: String,
}

#[tauri::command]
pub fn get_music_discovery() -> Result<Vec<MusicTrack>, String> {
    let path = music_discovery_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let c = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&c).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_music_track(mut track: MusicTrack) -> Result<(), String> {
    let path = music_discovery_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if track.id.is_empty() {
        track.id = uuid::Uuid::new_v4().to_string();
    }
    if track.discovered_at == 0 {
        track.discovered_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
    }
    let mut tracks: Vec<MusicTrack> = if path.exists() {
        let c = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&c).unwrap_or_default()
    } else {
        vec![]
    };
    let existing = tracks.iter_mut().find(|t| t.id == track.id);
    match existing {
        Some(e) => *e = track,
        None => tracks.insert(0, track),
    }
    let json = serde_json::to_string(&tracks).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_music_track(id: String) -> Result<(), String> {
    let path = music_discovery_path();
    if !path.exists() {
        return Ok(());
    }
    let c = fs::read_to_string(&path).unwrap_or_default();
    let mut tracks: Vec<MusicTrack> =
        serde_json::from_str(&c).map_err(|e| e.to_string())?;
    tracks.retain(|t| t.id != id);
    let json = serde_json::to_string(&tracks).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_and_recognize(
    app: AppHandle,
    duration_secs: u64,
    audiodb_key: String,
) -> Result<String, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use hound::{WavSpec, WavWriter};

    let temp_dir = std::env::temp_dir().join("Zenith");
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let docs = dirs_path().ok_or("Cannot find Documents folder")?;
    let debug_dir = docs.join("Zenith Recordings");
    fs::create_dir_all(&debug_dir).map_err(|e| e.to_string())?;
    let ts = chrono_id();
    let filename = format!("mic_recording_{}.wav", ts);
    let debug_path = debug_dir.join(&filename);
    let wav_path = temp_dir.join(&filename);

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No microphone found — check your input device")?;
    let device_name = device.name().unwrap_or_default();
    let supported_config = device
        .default_input_config()
        .map_err(|e| format!("Mic config error: {}", e))?;
    let sample_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels() as u16;

    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let writer1 = std::sync::Arc::new(std::sync::Mutex::new(
        WavWriter::create(&wav_path, spec).map_err(|e| e.to_string())?,
    ));
    let writer2 = std::sync::Arc::new(std::sync::Mutex::new(
        WavWriter::create(&debug_path, spec).map_err(|e| e.to_string())?,
    ));
    let writer1_clone = writer1.clone();
    let writer2_clone = writer2.clone();

    let stream_config: cpal::StreamConfig = supported_config.config();
    let (tx, _rx) = std::sync::mpsc::channel();

    let record_secs = duration_secs.min(30).max(3);
    let sample_count = std::sync::Arc::new(std::sync::Mutex::new(0u64));
    let sample_count_clone = sample_count.clone();

    let stream = device
        .build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mut w1 = writer1_clone.lock().unwrap();
                let mut w2 = writer2_clone.lock().unwrap();
                for frame in data.chunks(channels as usize) {
                    let mut mono: f32 = 0.0;
                    for &s in frame {
                        mono += s;
                    }
                    mono /= channels as f32;
                    mono *= 4.0;
                    let sample = (mono.clamp(-1.0, 1.0) * 32767.0) as i16;
                    w1.write_sample(sample).ok();
                    w2.write_sample(sample).ok();
                }
                *sample_count_clone.lock().unwrap() += data.len() as u64;
            },
            move |err| {
                let _ = tx.send(err.to_string());
            },
            None,
        )
        .map_err(|e| {
            format!(
                "Failed to open mic ({} {} {:.0}Hz): {}. Check Windows Settings > Privacy > Microphone.",
                device_name,
                if channels == 1 { "Mono" } else { "Stereo" },
                sample_rate as f64 / 1000.0,
                e
            )
        })?;

    stream.play().map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_secs(record_secs));
    drop(stream);
    drop(writer1);
    drop(writer2);

    let file_size = wav_path.metadata().map(|m| m.len()).unwrap_or(0);
    let total_samples = *sample_count.lock().unwrap();
    if file_size < 1024 || total_samples < sample_rate as u64 * record_secs / 2 {
        return Err(format!(
            "Recording produced only {} bytes / {} samples. Mic may be muted or disconnected. Debug recording saved to: {}",
            file_size,
            total_samples,
            debug_path.display()
        ));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &debug_path.to_string_lossy()])
            .spawn()
            .ok();
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&debug_path)
            .spawn()
            .ok();
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&debug_path)
            .spawn()
            .ok();
    }

    let staged = create_staged_item_from_path(&debug_path.to_string_lossy());
    if let Ok(item) = staged {
        let id = item.id.clone();
        let _app = app.clone();
        let _ = (id, _app);
    }

    let dbg_info = format!(
        "{} {} {:.0}Hz | {} samples | {} KB | Saved: {}",
        device_name,
        if channels == 1 { "Mono" } else { "Stereo" },
        sample_rate as f64 / 1000.0,
        total_samples,
        file_size / 1024,
        debug_path.display()
    );

    let args = serde_json::json!({
        "path": wav_path.to_string_lossy(),
        "audiodb_key": audiodb_key,
    });
    let args_str = serde_json::to_string(&args).unwrap_or_default();

    let resource = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let cwd_parent = cwd
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| cwd.clone());
    let script = "scripts/process_files.py";
    let full_path = [
        resource.join(script),
        cwd.join(script),
        cwd_parent.join(script),
    ]
    .into_iter()
    .find(|p: &PathBuf| p.exists())
    .ok_or_else(|| "process_files.py not found")?;

    let mut cmd = std::process::Command::new("python");
    cmd.arg("-u")
        .arg(&full_path)
        .arg("recognize_audio")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    {
        use std::io::Write;
        let mut stdin_writer =
            std::io::BufWriter::new(child.stdin.take().unwrap());
        stdin_writer
            .write_all(args_str.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();
    let mut result: serde_json::Value = serde_json::from_str(&stdout)
        .unwrap_or(serde_json::json!({"ok": false, "error": stdout}));
    result["recording_path"] = serde_json::json!(wav_path.to_string_lossy());
    result["debug_info"] = serde_json::json!(dbg_info);
    result["debug_file"] = serde_json::json!(debug_path.to_string_lossy());
    Ok(result.to_string())
}
