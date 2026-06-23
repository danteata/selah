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
use tauri::{AppHandle, Emitter, Manager};
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
                // The system browser did the OAuth and landed on
                // `http://localhost:19888/oauth-callback?<query>`.
                // The Tauri webview's React app is currently on
                // a Tauri origin (e.g. `tauri://localhost/login`)
                // and needs to load `<DesktopOAuthCallback />` to
                // process the handshake.
                //
                // We navigate the Tauri webview via `webview.eval`
                // because every JS-side path (event delivery,
                // React Router history updates, postMessage)
                // proved unreliable in the Tauri 2 webview. The
                // Rust side is the only place with a reliable hook
                // into the webview's URL.
                //
                // The Tauri 2 asset server has no SPA fallback — it
                // returns 500 for any path that doesn't match a
                // real file in `dist/`. The only path it serves
                // reliably is the root path `/` (which maps to
                // `index.html`, the Vite entry point). So we
                // navigate to a root-relative `/?<query>` — the
                // browser resolves it against the webview's current
                // origin (`http://localhost:3000` in dev, served by
                // Vite; `tauri://localhost` in production, served by
                // the asset server). Hard-coding `tauri://localhost/`
                // here would break dev mode, where the Vite dev
                // server is the origin and `tauri://` resolves to
                // the empty `dist/` (no `bun run build` yet). The
                // React app re-mounts at the root, `App.tsx`'s
                // useEffect reads the query string, sees
                // `__clerk_handshake`, and renders
                // `<DesktopOAuthCallback />` directly. After
                // processing, the component navigates to `/` (the
                // same root path, also served by the asset
                // server) and the `<SignedIn>` guard renders the
                // dashboard.
                // IMPORTANT: we do NOT navigate/reload the webview here.
                //
                // Reloading the webview to `/?__clerk_handshake=...` made
                // clerk-js process the handshake on a fresh page load, and
                // on the packaged `tauri://localhost` origin that path
                // redirected the webview to Clerk's hosted Account Portal
                // ("Start building") instead of completing in-app.
                //
                // Instead we leave the webview exactly where it is (the
                // welcome screen, which still holds the live in-memory
                // `SignIn` created by `signIn.create(...)`), bring it to
                // the foreground, and emit the callback event. The frontend
                // (`useOAuthCallback`) completes the sign-in in place by
                // reloading that `SignIn` and calling `setActive` — no page
                // reload, no handshake redirect, no hosted portal.
                if let Some(window) = app_handle.get_webview_window("main") {
                    // Bring the desktop app back to the foreground — the
                    // system browser stole focus during the OAuth.
                    let _ = window.set_focus();
                } else {
                    eprintln!("[oauth] no main webview window to focus");
                }
                // Branded success page for the system browser. The Tauri
                // webview is being navigated/finalized independently; this
                // is what the user sees in the browser tab. It tries to
                // close itself (works only for script-opened tabs) and
                // otherwise tells the user they can return to Selah.
                let body = br##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signed in to Selah</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #0f2a27 0%, #08090c 60%);
    color: #e7e5e4;
    display: flex; align-items: center; justify-content: center;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    text-align: center;
    padding: 48px 40px;
    max-width: 420px;
    animation: rise .5s cubic-bezier(.2,.7,.2,1) both;
  }
  .badge {
    width: 76px; height: 76px; margin: 0 auto 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #14b8a6, #0d9488);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 12px 40px -8px rgba(20,184,166,.55), inset 0 1px 0 rgba(255,255,255,.25);
    animation: pop .5s .15s cubic-bezier(.2,.9,.2,1.2) both;
  }
  .badge svg { width: 38px; height: 38px; }
  .badge path { stroke-dasharray: 30; stroke-dashoffset: 30; animation: draw .45s .35s ease forwards; }
  h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 10px; letter-spacing: -.01em; color: #fafaf9; }
  p { margin: 0; color: #a8a29e; font-size: .95rem; line-height: 1.6; }
  .hint { margin-top: 22px; font-size: .8rem; color: #57534e; }
  @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  @keyframes pop { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @keyframes draw { to { stroke-dashoffset: 0; } }
</style>
</head>
<body>
  <main class="card">
    <div class="badge" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>You're signed in</h1>
    <p>Sign-in complete &mdash; head back to the Selah app to continue.</p>
    <p class="hint">You can close this tab.</p>
  </main>
  <script>setTimeout(function(){ try { window.close(); } catch (e) {} }, 1200);</script>
</body>
</html>"##;
                let resp = Response::from_data(body.to_vec()).with_header(
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
