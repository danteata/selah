// One-shot HTTP server that captures the OAuth callback on desktop.
//
// On the web build the browser's normal redirect handling works because
// `window.location.origin` is already http(s). On Tauri desktop there is
// no such origin — the webview's URL is `tauri://localhost` and the
// only schemes Clerk's API will accept for `redirect_url` are `http` /
// `https` (no custom URL schemes allowed). So we run a one-shot local
// HTTP listener that Clerk's redirect lands on, parse the query
// string Clerk sends, and forward the callback URL to the frontend
// over a Tauri event. The frontend then calls
// `clerk.handleRedirectCallback({ redirectUrl })` to complete the flow.
//
// Why a fixed port (19888) instead of a random one:
//   - Clerk's server-side validation requires a real http(s) URL.
//   - Using a random port would mean re-adding it to Clerk's allowlist
//     on every launch.
//   - Localhost ports don't conflict with other apps in practice for
//     a single-user desktop app; if 19888 is taken, we fail fast and
//     the frontend falls back to a clear error message.
//
// The listener is one-shot: it accepts a single request to the
// callback path, then drops the TCP listener. The thread exits
// naturally. If the user cancels the OAuth flow, the listener is
// reaped on the next call to `start_oauth_listener`.

use std::net::SocketAddr;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tiny_http::{Response, Server};
use tracing::info;

/// The localhost port the OAuth listener binds to. Hardcoded so the
/// Clerk redirect URL is stable across launches (the user adds it
/// to Clerk's allowed redirect URLs once, not every session).
pub const OAUTH_LISTENER_PORT: u16 = 19888;

/// The fixed callback path Clerk will redirect to. Combined with the
/// port above, the full URL the frontend passes to
/// `signIn.authenticateWithRedirect({ redirectUrl })` is
/// `http://localhost:19888/oauth-callback`.
pub const OAUTH_CALLBACK_PATH: &str = "/oauth-callback";

/// The Tauri event name the listener emits when Clerk's OAuth
/// redirect lands. The frontend's `useOAuthCallback` hook subscribes
/// to this.
pub const OAUTH_CALLBACK_EVENT: &str = "oauth://callback";

/// Tracks whether a listener is currently running so two concurrent
/// OAuth attempts don't fight for the same port. Stored as a
/// `OnceLock<bool>` because we only need a single shared slot — the
/// flag flips to `true` when we bind, back to `false` when the
/// listener thread exits.
static LISTENER_ACTIVE: OnceLock<std::sync::Mutex<bool>> = OnceLock::new();

fn active_flag() -> &'static std::sync::Mutex<bool> {
    LISTENER_ACTIVE.get_or_init(|| std::sync::Mutex::new(false))
}

/// Tauri command: start (or reuse) the OAuth callback listener and
/// return the absolute callback URL Clerk should redirect to. The
/// listener runs in a background thread; this call returns
/// immediately once the server is bound.
#[tauri::command]
pub fn start_oauth_listener(app: AppHandle) -> Result<String, String> {
    let mut flag = active_flag().lock().unwrap();
    if *flag {
        // A previous listener is still running. Reuse the same URL.
        return Ok(format!(
            "http://localhost:{}{}",
            OAUTH_LISTENER_PORT, OAUTH_CALLBACK_PATH
        ));
    }
    *flag = true;
    drop(flag);

    let addr: SocketAddr = format!("127.0.0.1:{}", OAUTH_LISTENER_PORT)
        .parse()
        .map_err(|e| format!("invalid oauth listener addr: {}", e))?;

    let server = Server::http(addr)
        .map_err(|e| format!(
            "failed to bind oauth listener on port {}: {}. \
             Is another Selah instance running?",
            OAUTH_LISTENER_PORT, e
        ))?;

    info!(
        "[oauth] callback listener bound on http://localhost:{}{}",
        OAUTH_LISTENER_PORT, OAUTH_CALLBACK_PATH
    );

    // Spawn the accept loop. We only handle ONE request — the
    // Clerk OAuth callback — then close the server. The thread
    // exits naturally.
    let app_handle = app.clone();
    thread::spawn(move || {
        let callback_url = match server.recv_timeout(Duration::from_secs(300)) {
            Ok(Some(req)) => {
                let url = req.url().to_string();
                // Send a minimal success page. The webview is going
                // to navigate away or the event handler will close
                // it; either way a tiny HTML payload is enough.
                let body = b"<html><body style=\"font-family:sans-serif;padding:32px;\">\
                    <h2>Sign-in complete</h2>\
                    <p>You can close this tab and return to Selah.</p>\
                    </body></html>";
                let resp = Response::from_data(body)
                    .with_header(
                        "Content-Type: text/html; charset=utf-8"
                            .parse::<tiny_http::Header>()
                            .expect("static header is valid"),
                    );
                if let Err(e) = req.respond(resp) {
                    eprintln!("[oauth] failed to send callback response: {}", e);
                }
                url
            }
            Ok(None) => {
                eprintln!("[oauth] listener closed without a request");
                String::new()
            }
            Err(e) => {
                eprintln!("[oauth] listener recv error: {}", e);
                String::new()
            }
        };

        // Free the port for the next call.
        if let Ok(mut flag) = active_flag().lock() {
            *flag = false;
        }

        if !callback_url.is_empty() {
            // `req.url()` is the path-and-query portion of the
            // request line (e.g. `/oauth-callback?code=...&state=...`).
            // The frontend reconstructs a fully-qualified URL by
            // prepending the localhost origin.
            info!("[oauth] callback received: {}", callback_url);
            if let Err(e) = app_handle.emit(OAUTH_CALLBACK_EVENT, callback_url) {
                eprintln!("[oauth] failed to emit callback event: {}", e);
            }
        }
    });

    Ok(format!(
        "http://localhost:{}{}",
        OAUTH_LISTENER_PORT, OAUTH_CALLBACK_PATH
    ))
}
