use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use anyhow::{Context, Result};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const BUNDLED_RUNTIME_DIR: &str = "bundled-runtime";
#[cfg(target_os = "windows")]
const BUNDLED_BUN_BINARY: &str = "bun.exe";
#[cfg(not(target_os = "windows"))]
const BUNDLED_BUN_BINARY: &str = "bun";
const PROXY_PORT: &str = "8086";
const OAUTH_CALLBACK_PORT: &str = "38080";
const DASHBOARD_URL: &str = "http://127.0.0.1:8086/";
const TRAY_ID: &str = "antigravity-proxy-tray";
const OPEN_DASHBOARD_ID: &str = "open-dashboard";
const AUTOSTART_ID: &str = "start-with-windows";
const QUIT_ID: &str = "quit";

#[derive(Default)]
struct ProxyState {
    child: Mutex<Option<Child>>,
}

struct AutostartMenu(CheckMenuItem<tauri::Wry>);

#[tauri::command]
fn autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable()
    } else {
        autostart.disable()
    }
    .map_err(|e| e.to_string())?;
    app.state::<AutostartMenu>()
        .0
        .set_checked(enabled)
        .map_err(|e| e.to_string())?;
    app.emit("autostart-changed", enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_accounts() -> Result<(), String> {
    webbrowser::open("http://127.0.0.1:8086/#accounts").map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_welcome(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())?;
    window.set_skip_taskbar(true).map_err(|e| e.to_string())
}

fn proxy_source_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("proxy-app");
        if bundled.exists() {
            return bundled;
        }
    }

    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("proxy-app")
}

fn bundled_bun_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir
            .join(BUNDLED_RUNTIME_DIR)
            .join(BUNDLED_BUN_BINARY);
        if bundled.exists() {
            return Some(bundled);
        }
    }

    let local = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(BUNDLED_RUNTIME_DIR)
        .join(BUNDLED_BUN_BINARY);
    if local.exists() {
        return Some(local);
    }

    None
}

fn proxy_home_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let home = app
        .path()
        .app_data_dir()
        .context("could not resolve app data directory")?
        .join("proxy-home");

    fs::create_dir_all(home.join(".config/antigravity-proxy"))
        .context("could not create proxy config directory")?;
    fs::create_dir_all(home.join("logs")).context("could not create log directory")?;

    Ok(home)
}

fn log_file(path: &Path) -> Result<std::fs::File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("could not open log file at {}", path.display()))
}

fn start_proxy(app: &tauri::AppHandle) -> Result<Child> {
    let proxy_dir = proxy_source_dir(app);
    let home_dir = proxy_home_dir(app)?;
    let logs_dir = home_dir.join("logs");
    let stdout = log_file(&logs_dir.join("proxy.log"))?;
    let stderr = log_file(&logs_dir.join("proxy-error.log"))?;
    let runtime_path = bundled_bun_path(app).unwrap_or_else(|| PathBuf::from("bun"));

    let mut command = Command::new(&runtime_path);
    command
        .current_dir(&proxy_dir)
        .arg(proxy_dir.join("src").join("index.js"))
        .env("PORT", PROXY_PORT)
        .env("HOST", "127.0.0.1")
        .env("OAUTH_CALLBACK_PORT", OAUTH_CALLBACK_PORT)
        .env("HOME", &home_dir)
        .env("USERPROFILE", &home_dir)
        .env("ANTIGRAVITY_DISABLE_DB_FALLBACK", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn().with_context(|| {
        format!(
            "failed to launch bundled proxy with {}",
            runtime_path.display()
        )
    })
}

fn stop_proxy(app: &tauri::AppHandle) {
    let state = app.state::<ProxyState>();
    let child = {
        let mut guard = state.child.lock().expect("proxy lock poisoned");
        guard.take()
    };

    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn open_dashboard() {
    let _ = webbrowser::open(DASHBOARD_URL);
}

fn build_tray(app: &tauri::AppHandle) -> Result<()> {
    let open_item =
        MenuItem::with_id(app, OPEN_DASHBOARD_ID, "Open Dashboard", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)?;
    let autostart_item = CheckMenuItem::with_id(
        app,
        AUTOSTART_ID,
        "Start with Windows",
        true,
        app.autolaunch().is_enabled()?,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&open_item, &autostart_item, &quit_item])?;
    app.manage(AutostartMenu(autostart_item));

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(
            app.default_window_icon()
                .context("missing default window icon")?
                .clone(),
        )
        .tooltip("Antigravity Proxy Tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_DASHBOARD_ID => open_dashboard(),
            AUTOSTART_ID => {
                let result = autostart_enabled(app.clone())
                    .and_then(|enabled| set_autostart(app.clone(), !enabled));
                if let Err(error) = result {
                    // Native check items toggle before this callback; restore on failure.
                    if let Ok(enabled) = app.autolaunch().is_enabled() {
                        let _ = app.state::<AutostartMenu>().0.set_checked(enabled);
                    }
                    let _ = app.emit("autostart-error", error);
                }
            }
            QUIT_ID => {
                stop_proxy(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_dashboard();
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ProxyState::default())
        .invoke_handler(tauri::generate_handler![
            autostart_enabled,
            set_autostart,
            open_accounts,
            hide_welcome
        ])
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                let _ = window.set_skip_taskbar(true);
            }
        })
        .setup(|app| {
            // Check before starting the proxy, which may create its accounts file.
            let first_run = !proxy_home_dir(app.handle())?
                .join(".config/antigravity-proxy/accounts.json")
                .is_file();
            build_tray(app.handle())?;

            let proxy = start_proxy(app.handle())?;
            *app.state::<ProxyState>()
                .child
                .lock()
                .expect("proxy lock poisoned") = Some(proxy);

            if let Some(window) = app.get_webview_window("main") {
                window.set_skip_taskbar(!first_run)?;
                if first_run {
                    window.show()?;
                    window.set_focus()?;
                } else {
                    window.hide()?;
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_proxy(app);
        }
    });
}
