use std::{fs, time::Duration};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    webview::NewWindowResponse,
    Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

fn website_url(address: &str) -> Result<Url, String> {
    let url = Url::parse(address.trim())
        .map_err(|_| "Enter a complete website address, starting with https://.")?;
    let loopback = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("Use HTTPS for your website. HTTP is allowed only on localhost.".into());
    }
    if !url.username().is_empty() || url.password().is_some() || url.host().is_none() {
        return Err("Use a website address without a username or password in it.".into());
    }
    Url::parse(&format!("{}/app", url.origin().ascii_serialization())).map_err(|e| e.to_string())
}

fn local_launcher(url: &Url) -> bool {
    (url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none())
        || matches!(
            url.origin().ascii_serialization().as_str(),
            "http://tauri.localhost" | "https://tauri.localhost"
        )
        || (cfg!(debug_assertions) && url.origin().ascii_serialization() == "http://127.0.0.1:1420")
}

fn check_caller(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" || !local_launcher(&window.url().map_err(|e| e.to_string())?) {
        return Err("This command is available only on the bundled connection screen.".into());
    }
    Ok(())
}

#[tauri::command]
fn saved_website(app: tauri::AppHandle, window: WebviewWindow) -> Result<Option<String>, String> {
    check_caller(&window)?;
    let file = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("website.txt");
    Ok(fs::read_to_string(file)
        .ok()
        .and_then(|value| website_url(&value).ok())
        .map(|url| url.origin().ascii_serialization()))
}

#[tauri::command]
async fn connect_website(
    app: tauri::AppHandle,
    window: WebviewWindow,
    address: String,
) -> Result<(), String> {
    check_caller(&window)?;
    let url = website_url(&address)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url.join("/auth/state").map_err(|e| e.to_string())?)
        .send()
        .await
        .map_err(|_| {
            "Could not reach the website securely. Check its address, certificate and connection."
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "The website returned {}. Use its final HTTPS address.",
            response.status()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the website response.")?
    {
        if bytes.len() + chunk.len() > 65536 {
            return Err("This address did not return a Rex workspace.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let state: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "This address is not a Rex website. Check the address.")?;
    if !state["signupOpen"].is_boolean()
        || !state["needsSetup"].is_boolean()
        || !state["workspaceName"].is_string()
    {
        return Err("This address is not a compatible Rex website.".into());
    }
    if let Some(existing) = app.get_webview_window("workspace") {
        existing.destroy().map_err(|e| e.to_string())?;
        for _ in 0..40 {
            if app.get_webview_window("workspace").is_none() {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        if app.get_webview_window("workspace").is_some() {
            return Err("The previous workspace is still closing. Try connecting again.".into());
        }
    }
    let origin = url.origin();
    let link_app = app.clone();
    let popup_app = app.clone();
    let workspace = WebviewWindowBuilder::new(&app, "workspace", WebviewUrl::External(url.clone()))
        .title(format!("Rex · {}", url.host_str().unwrap_or("Workspace")))
        .inner_size(1200.0, 800.0)
        .min_inner_size(390.0, 560.0)
        .on_navigation(move |destination| {
            if destination.origin() == origin {
                return true;
            }
            if matches!(destination.scheme(), "https" | "http") {
                let _ = link_app
                    .opener()
                    .open_url(destination.as_str(), None::<&str>);
            }
            false
        })
        .on_new_window(move |destination, _| {
            if matches!(destination.scheme(), "https" | "http") {
                let _ = popup_app
                    .opener()
                    .open_url(destination.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|e| e.to_string())?;
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    fs::write(
        directory.join("website.txt"),
        url.origin().ascii_serialization(),
    )
    .map_err(|e| e.to_string())?;
    workspace.set_focus().map_err(|e| e.to_string())?;
    window.hide().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![connect_website, saved_website])
        .setup(|app| {
            WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?
                .on_navigation(local_launcher)
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            let change = MenuItem::with_id(
                app,
                "change-website",
                "Change website…",
                true,
                Some("CmdOrCtrl+Shift+W"),
            )?;
            let reload = MenuItem::with_id(
                app,
                "reload-workspace",
                "Reload workspace",
                true,
                Some("CmdOrCtrl+R"),
            )?;
            let submenu = Submenu::with_items(
                app,
                "Rex",
                true,
                &[&change, &reload, &PredefinedMenuItem::quit(app, None)?],
            )?;
            app.set_menu(Menu::with_items(app, &[&submenu])?)?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "change-website" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "reload-workspace" => {
                if let Some(window) = app.get_webview_window("workspace") {
                    let _ = window.reload();
                }
            }
            _ => {}
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && window
                    .app_handle()
                    .get_webview_window("workspace")
                    .is_some()
            {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            if window.label() == "workspace" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(launcher) = window.app_handle().get_webview_window("main") {
                    let _ = launcher.show();
                    let _ = launcher.set_focus();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Rex desktop");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn websites_require_tls_and_never_keep_credentials() {
        for input in [
            "http://example.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://u:p@example.com",
            "https://u@example.com",
            "not a url",
        ] {
            assert!(website_url(input).is_err(), "{input}");
        }
        assert_eq!(
            website_url("https://rex.example.com/bot/123?token=secret#x")
                .unwrap()
                .as_str(),
            "https://rex.example.com/app"
        );
        for input in [
            "http://localhost:5173",
            "http://127.0.0.1:8787",
            "http://[::1]:8787",
        ] {
            assert!(website_url(input).is_ok());
        }
    }
    #[test]
    fn remote_websites_are_never_launcher_origins() {
        assert!(!local_launcher(
            &Url::parse("https://rex.example.com").unwrap()
        ));
        assert!(!local_launcher(
            &Url::parse("https://localhost.attacker.com").unwrap()
        ));
        assert!(!local_launcher(
            &Url::parse("http://tauri.localhost:9999").unwrap()
        ));
        assert!(local_launcher(
            &Url::parse("tauri://localhost/index.html").unwrap()
        ));
    }
}
