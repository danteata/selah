//! Global (system-wide) shortcut registry.
//!
//! Two features want system-wide hotkeys: presentation control — next slide,
//! blank, go live, which work while the operator is in another application —
//! and dictation push-to-talk. They must not each keep their own set. Two
//! registries cannot see each other's bindings, so neither can report a
//! conflict, and a rebind in one loses silently to a stale registration in the
//! other. The whole set lives here, and callers describe what they want rather
//! than registering it themselves.
//!
//! The frontend owns the *meaning* of a binding; this module owns only the OS
//! registration. A press arrives back as `shortcut://triggered` carrying the
//! logical action name, and the React layer decides what that action does. That
//! split is deliberate: the sermon-listener and dictation pipelines already live
//! in the React layer (see the tray's "toggle listening" for the same pattern),
//! and moving one half of them into Rust to serve a keystroke would buy nothing.
//!
//! ## Rebinding without a restart
//!
//! [`set_global_shortcuts`] is the whole interface, and it is idempotent: it
//! drops every binding it holds and applies the set it was given. A settings
//! change re-invokes it. Registering once at startup and never again is a
//! well-known trap — the setting moves, the binding does not, and the operator
//! reasonably concludes the feature is broken.
//!
//! The swap is not atomic. `unregister_all` lands before the new set is applied,
//! so a re-registration that fails leaves that action unbound rather than
//! falling back to what it replaced. That is the honest outcome — the accelerator
//! the operator just chose is taken by something else, and pretending otherwise
//! by silently keeping the old key would be worse. Failures come back in the
//! return value so the UI can say which ones, and why.

use std::str::FromStr;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tracing::{info, warn};

/// One binding as the frontend describes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutBinding {
    /// Logical name the frontend dispatches on, e.g. `"dictation.push-to-talk"`.
    /// Opaque to this module.
    pub action: String,
    /// Tauri accelerator string, e.g. `"CommandOrControl+Shift+D"`.
    pub accelerator: String,
    /// Whether this action needs the key-release event as well as the press.
    ///
    /// Push-to-talk does — the release is what ends the utterance. A slide
    /// advance does not, and delivering both would advance two slides per
    /// keypress, which is the kind of bug that only shows up in front of a
    /// congregation.
    #[serde(default)]
    pub wants_release: bool,
}

/// Why one binding in a set could not be applied. Returned rather than thrown:
/// one bad accelerator should not cost the operator the other four.
#[derive(Debug, Clone, Serialize)]
pub struct ShortcutFailure {
    pub action: String,
    pub accelerator: String,
    pub reason: String,
}

/// The `shortcut://triggered` payload.
#[derive(Debug, Clone, Serialize)]
struct ShortcutEventPayload<'a> {
    action: &'a str,
    /// `"pressed"` or `"released"`.
    state: &'static str,
}

/// Everything currently registered with the OS.
///
/// A `Vec` rather than a map keyed by `Shortcut`: the set is a handful of
/// entries, the handler runs on a keystroke rather than in a loop, and a linear
/// scan over six items costs nothing while avoiding a dependency on the exact
/// hashing behaviour of the plugin's key type.
#[derive(Default)]
pub struct ShortcutRegistry {
    bound: Mutex<Vec<(Shortcut, ShortcutBinding)>>,
}

impl ShortcutRegistry {
    fn find(&self, shortcut: &Shortcut) -> Option<ShortcutBinding> {
        self.bound
            .lock()
            .ok()?
            .iter()
            .find(|(candidate, _)| candidate == shortcut)
            .map(|(_, binding)| binding.clone())
    }

    fn replace(&self, entries: Vec<(Shortcut, ShortcutBinding)>) {
        if let Ok(mut bound) = self.bound.lock() {
            *bound = entries;
        }
    }

    fn snapshot(&self) -> Vec<ShortcutBinding> {
        self.bound
            .lock()
            .map(|bound| bound.iter().map(|(_, binding)| binding.clone()).collect())
            .unwrap_or_default()
    }
}

/// The plugin's single handler: resolve the fired shortcut back to its action
/// and hand it to the frontend.
///
/// Unknown shortcuts are ignored rather than logged at warn level. A shortcut
/// can fire between `unregister_all` and the frontend hearing about it, and a
/// rebind mid-service should not fill the log with noise about a key the
/// operator already moved on from.
pub fn handle_shortcut(app: &AppHandle, shortcut: &Shortcut, state: ShortcutState) {
    let registry: State<ShortcutRegistry> = app.state();
    let Some(binding) = registry.find(shortcut) else {
        return;
    };

    let state = match state {
        ShortcutState::Pressed => "pressed",
        ShortcutState::Released => {
            if !binding.wants_release {
                return;
            }
            "released"
        }
    };

    let _ = app.emit(
        "shortcut://triggered",
        ShortcutEventPayload {
            action: &binding.action,
            state,
        },
    );
}

/// Apply a complete set of global shortcuts, replacing whatever is bound now.
///
/// Returns the bindings that could not be applied. An empty vector means all of
/// them took.
#[tauri::command]
pub async fn set_global_shortcuts(
    app: AppHandle,
    bindings: Vec<ShortcutBinding>,
) -> Result<Vec<ShortcutFailure>, String> {
    let manager = app.global_shortcut();

    // Drop everything first. See the module note on why this is not atomic.
    if let Err(err) = manager.unregister_all() {
        warn!("[shortcuts] unregister_all failed: {err}");
    }

    let mut applied: Vec<(Shortcut, ShortcutBinding)> = Vec::with_capacity(bindings.len());
    let mut failures: Vec<ShortcutFailure> = Vec::new();

    for binding in bindings {
        let shortcut = match Shortcut::from_str(&binding.accelerator) {
            Ok(shortcut) => shortcut,
            Err(err) => {
                failures.push(ShortcutFailure {
                    action: binding.action,
                    accelerator: binding.accelerator,
                    reason: format!("not a valid shortcut: {err}"),
                });
                continue;
            }
        };

        // A duplicate inside one set is the caller's bug, but it presents to the
        // OS as "already registered" and would be reported as a conflict with
        // another application, which sends whoever is debugging it somewhere
        // unhelpful. Catch it here and say what it actually is.
        if applied.iter().any(|(existing, _)| existing == &shortcut) {
            failures.push(ShortcutFailure {
                action: binding.action,
                accelerator: binding.accelerator,
                reason: "already used by another Selah action".to_string(),
            });
            continue;
        }

        match manager.register(shortcut.clone()) {
            Ok(()) => applied.push((shortcut, binding)),
            Err(err) => failures.push(ShortcutFailure {
                action: binding.action,
                accelerator: binding.accelerator,
                // Almost always another application holding the combination —
                // Spotlight on `Cmd+Space`, a launcher, a screenshot tool.
                reason: format!("in use by another application ({err})"),
            }),
        }
    }

    info!(
        "[shortcuts] {} registered, {} failed",
        applied.len(),
        failures.len()
    );

    app.state::<ShortcutRegistry>().replace(applied);

    Ok(failures)
}

/// Drop every global shortcut. Used when the operator turns the feature off,
/// and on the way out.
#[tauri::command]
pub async fn clear_global_shortcuts(app: AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|err| err.to_string())?;
    app.state::<ShortcutRegistry>().replace(Vec::new());
    Ok(())
}

/// What is bound right now — for the settings UI, and for diagnosing a hotkey
/// that "doesn't work" without asking the operator to read a log file.
#[tauri::command]
pub async fn list_global_shortcuts(app: AppHandle) -> Result<Vec<ShortcutBinding>, String> {
    Ok(app.state::<ShortcutRegistry>().snapshot())
}
