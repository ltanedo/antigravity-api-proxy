use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use anyhow::{Context, Result};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const BUNDLED_RUNTIME_DIR: &str = "bundled-runtime";
#[cfg(target_os = "windows")]
const BUNDLED_NODE_BINARY: &str = "node.exe";
#[cfg(not(target_os = "windows"))]
const BUNDLED_NODE_BINARY: &str = "node";
const PROXY_PORT: &str = "8086";
const OAUTH_CALLBACK_PORT: &str = "38080";
const DASHBOARD_URL: &str = "http://127.0.0.1:8086/";
const TRAY_ID: &str = "antigravity-proxy-tray";
const OPEN_DASHBOARD_ID: &str = "open-dashboard";
const QUIT_ID: &str = "quit";

#[derive(Default)]
struct ProxyState {
    child: Mutex<Option<Child>>,
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

fn bundled_node_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir
            .join(BUNDLED_RUNTIME_DIR)
            .join(BUNDLED_NODE_BINARY);
        if bundled.exists() {
            return Some(bundled);
        }
    }

    let local = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(BUNDLED_RUNTIME_DIR)
        .join(BUNDLED_NODE_BINARY);
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
    let node_path = bundled_node_path(app).unwrap_or_else(|| PathBuf::from("node"));

    let mut command = Command::new(&node_path);
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

    command
        .spawn()
        .with_context(|| format!("failed to launch bundled proxy with {}", node_path.display()))
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
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

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
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            build_tray(app.handle())?;

            let autostart = app.autolaunch();
            if !autostart.is_enabled().unwrap_or(false) {
                let _ = autostart.enable();
            }

            let proxy = start_proxy(app.handle())?;
            *app
                .state::<ProxyState>()
                .child
                .lock()
                .expect("proxy lock poisoned") = Some(proxy);

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
