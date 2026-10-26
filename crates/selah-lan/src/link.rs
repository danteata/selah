//! The live-session link between the desk and the phones on its Wi-Fi.
//!
//! The desk listens on a TCP port; a phone connects, proves it was paired with
//! this desk, and from then on each side sends lines of JSON. What the lines
//! say (the live slide, the deck, a phone's suggestion) is the apps' business:
//! this module only carries them, keeps the connection honest (pings, a size
//! limit, dropping a phone that went quiet) and decides who may connect.
//!
//! Trust is a pairing, like a Bluetooth device: the operator opens a pairing
//! window on the desk, which shows a six-digit code for two minutes, and a
//! phone that sends the code gets a long random token. Later connections
//! answer a fresh challenge with that token instead, so the token itself never
//! crosses the network again. A pairing outlives Convex, sign-in and the
//! internet, which is the point: the screen keeps answering the phones when
//! the connection to the outside world is down.
//!
//! Both ends are Rust (the desk app and the phone app), not a browser, so this
//! is plain TCP: a web page served over HTTPS can't open a connection to an
//! address on the local network, and the phone's web view needn't try.

use std::collections::HashMap;
use std::io;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Notify};
use tokio::task::JoinHandle;
use tokio::time::timeout;

/// Bumped when a change to the handshake would confuse the other end.
pub const PROTOCOL: u64 = 1;

/// A whole deck with an image or two inlined fits; anything bigger is a fault.
const MAX_LINE: usize = 16 * 1024 * 1024;
/// How often the desk pings each phone. A phone on Wi-Fi drops off without a
/// goodbye (out of range, screen off), and only silence gives that away.
const PING_EVERY: Duration = Duration::from_secs(10);
/// Silence after which the other end is taken to be gone.
const SILENCE_LIMIT: Duration = Duration::from_secs(30);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
/// How long a pairing code works once the operator shows it.
pub const PAIRING_WINDOW: Duration = Duration::from_secs(120);
/// Wrong codes before the pairing window closes: six digits is a million
/// guesses, and this leaves an attacker five.
const PAIRING_ATTEMPTS: u32 = 5;

const PING: &str = r#"{"t":"ping"}"#;
const PONG: &str = r#"{"t":"pong"}"#;

// --- Framing ---------------------------------------------------------------

/// One line, without its newline. `None` at the end of the stream.
async fn read_frame<R: AsyncBufRead + Unpin>(reader: &mut R) -> io::Result<Option<String>> {
    let mut buf = Vec::new();
    let read = (&mut *reader).take(MAX_LINE as u64 + 1).read_until(b'\n', &mut buf).await?;
    if read == 0 {
        return Ok(None);
    }
    if buf.last() != Some(&b'\n') {
        if buf.len() > MAX_LINE {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "message too long"));
        }
        return Ok(None); // the stream ended mid-line
    }
    buf.pop();
    if buf.last() == Some(&b'\r') {
        buf.pop();
    }
    String::from_utf8(buf).map(Some).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, text: &str) -> io::Result<()> {
    // A raw newline would split the message in two. JSON never has one.
    if text.contains('\n') {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "a message can't contain a newline"));
    }
    writer.write_all(text.as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await
}

fn kind_of(message: &Value) -> &str {
    message.get("t").and_then(Value::as_str).unwrap_or("")
}

// --- Secrets ---------------------------------------------------------------

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    to_hex(&buf)
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// HMAC-SHA256 (RFC 2104), so a phone proves it holds its token without
/// sending it.
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(block.map(|b| b ^ 0x36));
    inner.update(message);
    let mut outer = Sha256::new();
    outer.update(block.map(|b| b ^ 0x5c));
    outer.update(inner.finalize());
    outer.finalize().into()
}

fn proof(token: &str, nonce: &str) -> String {
    to_hex(&hmac_sha256(token.as_bytes(), nonce.as_bytes()))
}

/// Compare without stopping at the first difference, so timing says nothing.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// --- Pairings --------------------------------------------------------------

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairedDevice {
    id: String,
    name: String,
    token: String,
    paired_at: u64,
}

/// A paired phone, as the desk lists it (never its token).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSummary {
    pub id: String,
    pub name: String,
    pub paired_at: u64,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingsFile {
    #[serde(default)]
    desk_id: String,
    #[serde(default)]
    devices: Vec<PairedDevice>,
}

/// The phones this desk trusts, and the desk's own id, kept in a file so a
/// pairing survives restarts and updates.
pub struct Pairings {
    path: Option<PathBuf>,
    file: PairingsFile,
}

impl Pairings {
    /// Read the pairings at `path`, starting afresh if the file is missing or
    /// damaged (phones then pair again; nothing else is lost).
    pub fn load(path: PathBuf) -> Self {
        let file = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        let mut pairings = Pairings { path: Some(path), file };
        pairings.ensure_desk_id();
        pairings
    }

    /// Pairings that aren't saved anywhere.
    pub fn in_memory() -> Self {
        let mut pairings = Pairings { path: None, file: PairingsFile::default() };
        pairings.ensure_desk_id();
        pairings
    }

    fn ensure_desk_id(&mut self) {
        if self.file.desk_id.is_empty() {
            self.file.desk_id = random_hex(8);
            self.save();
        }
    }

    /// This desk's id: phones remember their token against it.
    pub fn desk_id(&self) -> &str {
        &self.file.desk_id
    }

    pub fn devices(&self) -> Vec<DeviceSummary> {
        self.file
            .devices
            .iter()
            .map(|d| DeviceSummary { id: d.id.clone(), name: d.name.clone(), paired_at: d.paired_at })
            .collect()
    }

    fn token_for(&self, device_id: &str) -> Option<String> {
        self.file.devices.iter().find(|d| d.id == device_id).map(|d| d.token.clone())
    }

    /// Trust `device_id`, replacing any earlier pairing of it, and return its token.
    fn add(&mut self, device_id: &str, name: &str) -> String {
        let token = random_hex(32);
        self.file.devices.retain(|d| d.id != device_id);
        self.file.devices.push(PairedDevice {
            id: device_id.to_string(),
            name: name.to_string(),
            token: token.clone(),
            paired_at: now_ms(),
        });
        self.save();
        token
    }

    fn forget(&mut self, device_id: &str) -> bool {
        let before = self.file.devices.len();
        self.file.devices.retain(|d| d.id != device_id);
        let removed = self.file.devices.len() != before;
        if removed {
            self.save();
        }
        removed
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(&self.file) {
            let _ = std::fs::write(path, text);
        }
    }
}

// --- The desk's end --------------------------------------------------------

/// What happens on the desk's link, for the desk app to act on.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HostEvent {
    /// A phone connected and proved itself. `device` and `user` are what the
    /// phone said about itself (`{id, name}`, and who's signed in on it).
    #[serde(rename_all = "camelCase")]
    Joined { client: u64, device: Value, user: Value, paired_now: bool },
    Message { client: u64, text: String },
    Left { client: u64 },
}

struct PairingWindow {
    code: String,
    until: Instant,
    failures: u32,
}

struct ClientSlot {
    device_id: String,
    tx: mpsc::UnboundedSender<String>,
    kick: Arc<Notify>,
}

struct HostInner {
    desk_name: String,
    pairings: Mutex<Pairings>,
    pairing: Mutex<Option<PairingWindow>>,
    clients: Mutex<HashMap<u64, ClientSlot>>,
    next_client: AtomicU64,
    events: mpsc::UnboundedSender<HostEvent>,
}

/// The desk's listening end. Dropping it closes every phone's connection.
pub struct Host {
    inner: Arc<HostInner>,
    accept: JoinHandle<()>,
    port: u16,
}

impl Host {
    /// Listen on `port` (0 for any free port) on every interface.
    pub async fn start(
        port: u16,
        desk_name: String,
        pairings: Pairings,
        events: mpsc::UnboundedSender<HostEvent>,
    ) -> io::Result<Host> {
        let listener = TcpListener::bind(("0.0.0.0", port)).await?;
        let port = listener.local_addr()?.port();
        let inner = Arc::new(HostInner {
            desk_name,
            pairings: Mutex::new(pairings),
            pairing: Mutex::new(None),
            clients: Mutex::new(HashMap::new()),
            next_client: AtomicU64::new(1),
            events,
        });
        let accepting = inner.clone();
        let accept = tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        tokio::spawn(serve(accepting.clone(), stream));
                    }
                    // A failed accept (too many open files, a reset in the
                    // queue) is about that one connection; keep listening.
                    Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
                }
            }
        });
        Ok(Host { inner, accept, port })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn desk_id(&self) -> String {
        self.inner.pairings.lock().unwrap().desk_id().to_string()
    }

    /// Send to one phone. False if it's no longer connected.
    pub fn send(&self, client: u64, text: String) -> bool {
        let clients = self.inner.clients.lock().unwrap();
        clients.get(&client).map(|slot| slot.tx.send(text).is_ok()).unwrap_or(false)
    }

    /// Send to every connected phone.
    pub fn broadcast(&self, text: &str) {
        for slot in self.inner.clients.lock().unwrap().values() {
            let _ = slot.tx.send(text.to_string());
        }
    }

    /// Open the pairing window and return its code.
    pub fn begin_pairing(&self) -> String {
        let code = format!("{:06}", rand::thread_rng().next_u32() % 1_000_000);
        *self.inner.pairing.lock().unwrap() =
            Some(PairingWindow { code: code.clone(), until: Instant::now() + PAIRING_WINDOW, failures: 0 });
        code
    }

    pub fn end_pairing(&self) {
        *self.inner.pairing.lock().unwrap() = None;
    }

    pub fn devices(&self) -> Vec<DeviceSummary> {
        self.inner.pairings.lock().unwrap().devices()
    }

    /// Stop trusting a phone, and disconnect it if it's connected.
    pub fn forget(&self, device_id: &str) -> bool {
        let removed = self.inner.pairings.lock().unwrap().forget(device_id);
        for slot in self.inner.clients.lock().unwrap().values() {
            if slot.device_id == device_id {
                slot.kick.notify_one();
            }
        }
        removed
    }

    /// How many phones are connected.
    pub fn connected(&self) -> usize {
        self.inner.clients.lock().unwrap().len()
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.accept.abort();
        for slot in self.inner.clients.lock().unwrap().values() {
            slot.kick.notify_one();
        }
    }
}

/// Why a phone was turned away, in the reply it gets.
async fn deny<W: AsyncWrite + Unpin>(writer: &mut W, reason: &str) {
    let _ = write_frame(writer, &json!({ "t": "denied", "reason": reason }).to_string()).await;
}

/// Check a phone's hello. On success: its token if it was paired just now.
fn admit(inner: &HostInner, hello: &Value, nonce: &str) -> Result<Option<String>, &'static str> {
    let device_id = hello.pointer("/device/id").and_then(Value::as_str).unwrap_or("");
    if device_id.is_empty() || device_id.len() > 128 {
        return Err("hello");
    }
    match kind_of(hello) {
        "hello" => {
            let mac = hello.get("mac").and_then(Value::as_str).unwrap_or("");
            let token = inner.pairings.lock().unwrap().token_for(device_id).ok_or("unpaired")?;
            if same(&proof(&token, nonce), mac) { Ok(None) } else { Err("unpaired") }
        }
        "pair" => {
            let code = hello.get("code").and_then(Value::as_str).unwrap_or("").trim();
            let mut pairing = inner.pairing.lock().unwrap();
            let window = match pairing.as_mut() {
                Some(window) if window.until > Instant::now() => window,
                _ => {
                    *pairing = None;
                    return Err("not-pairing");
                }
            };
            if !same(&window.code, code) {
                window.failures += 1;
                if window.failures >= PAIRING_ATTEMPTS {
                    *pairing = None;
                }
                return Err("code");
            }
            let name = hello.pointer("/device/name").and_then(Value::as_str).unwrap_or("Phone");
            let name: String = name.chars().take(64).collect();
            Ok(Some(inner.pairings.lock().unwrap().add(device_id, &name)))
        }
        _ => Err("hello"),
    }
}

async fn serve(inner: Arc<HostInner>, stream: TcpStream) {
    let _ = stream.set_nodelay(true);
    let (read_half, mut writer) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    let nonce = random_hex(16);
    let desk = json!({ "id": inner.pairings.lock().unwrap().desk_id(), "name": inner.desk_name });
    let challenge = json!({ "t": "challenge", "v": PROTOCOL, "nonce": nonce, "desk": desk });
    if write_frame(&mut writer, &challenge.to_string()).await.is_err() {
        return;
    }

    let hello = match timeout(HANDSHAKE_TIMEOUT, read_frame(&mut reader)).await {
        Ok(Ok(Some(line))) => serde_json::from_str::<Value>(&line).unwrap_or(Value::Null),
        _ => return,
    };
    let token = match admit(&inner, &hello, &nonce) {
        Ok(token) => token,
        Err(reason) => return deny(&mut writer, reason).await,
    };
    let paired_now = token.is_some();
    if let Some(token) = token {
        if write_frame(&mut writer, &json!({ "t": "paired", "token": token }).to_string()).await.is_err() {
            return;
        }
    }
    if write_frame(&mut writer, &json!({ "t": "ok", "desk": desk }).to_string()).await.is_err() {
        return;
    }

    let client = inner.next_client.fetch_add(1, Ordering::Relaxed);
    let device = hello.get("device").cloned().unwrap_or(Value::Null);
    let user = hello.get("user").cloned().unwrap_or(Value::Null);
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let kick = Arc::new(Notify::new());
    inner.clients.lock().unwrap().insert(client, ClientSlot {
        device_id: device.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
        tx: tx.clone(),
        kick: kick.clone(),
    });
    let _ = inner.events.send(HostEvent::Joined { client, device, user, paired_now });

    let writing = tokio::spawn(async move {
        let mut ping = tokio::time::interval(PING_EVERY);
        ping.tick().await; // the first tick is immediate
        loop {
            let text = tokio::select! {
                next = rx.recv() => match next {
                    Some(text) => text,
                    None => break,
                },
                _ = ping.tick() => PING.to_string(),
            };
            if write_frame(&mut writer, &text).await.is_err() {
                break;
            }
        }
    });

    loop {
        let line = tokio::select! {
            read = timeout(SILENCE_LIMIT, read_frame(&mut reader)) => match read {
                Ok(Ok(Some(line))) => line,
                _ => break,
            },
            _ = kick.notified() => break,
        };
        if line == PONG {
            continue;
        }
        if line == PING {
            let _ = tx.send(PONG.to_string());
            continue;
        }
        let _ = inner.events.send(HostEvent::Message { client, text: line });
    }

    inner.clients.lock().unwrap().remove(&client);
    writing.abort();
    let _ = inner.events.send(HostEvent::Left { client });
}

// --- The phone's end -------------------------------------------------------

/// How a phone proves itself: a token from an earlier pairing, or the code
/// on the desk's screen.
#[derive(Debug, Clone)]
pub enum Auth {
    Token(String),
    Code(String),
}

#[derive(Debug, PartialEq)]
pub enum LinkError {
    /// Nothing answered at that address, or the connection broke.
    Unreachable(String),
    /// The desk turned the phone away: "unpaired" (pair again), "code" (wrong
    /// code), "not-pairing" (no pairing window open).
    Denied(String),
    /// Something answered that isn't a Selah desk speaking this protocol.
    Protocol(String),
}

impl std::fmt::Display for LinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LinkError::Unreachable(e) => write!(f, "unreachable: {e}"),
            LinkError::Denied(reason) => write!(f, "denied: {reason}"),
            LinkError::Protocol(e) => write!(f, "protocol: {e}"),
        }
    }
}

/// What a phone hears on its link.
#[derive(Debug, Clone, PartialEq)]
pub enum LinkEvent {
    Message(String),
    /// The link is gone; no more events follow.
    Closed(String),
}

/// A connected link, as the phone gets it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connected {
    /// The desk's `{id, name}`.
    pub desk: Value,
    /// The token to keep, if this connection paired the phone.
    pub token: Option<String>,
}

/// The desk's next message during the handshake.
async fn read_reply<R: AsyncBufRead + Unpin>(reader: &mut R) -> Result<Value, LinkError> {
    match timeout(HANDSHAKE_TIMEOUT, read_frame(reader)).await {
        Ok(Ok(Some(line))) => serde_json::from_str(&line).map_err(|_| LinkError::Protocol("not a Selah desk".into())),
        Ok(Ok(None)) => Err(LinkError::Unreachable("the desk closed the connection".into())),
        Ok(Err(e)) => Err(LinkError::Unreachable(e.to_string())),
        Err(_) => Err(LinkError::Protocol("no answer".into())),
    }
}

/// The phone's end of a link. Dropping it disconnects.
pub struct Link {
    tx: mpsc::UnboundedSender<String>,
    kick: Arc<Notify>,
}

impl Link {
    /// Connect to the desk at `addr`, introducing this phone as `device`
    /// (`{id, name}`) with `user` signed in on it.
    pub async fn connect(
        addr: SocketAddr,
        device: Value,
        user: Value,
        auth: Auth,
        events: mpsc::UnboundedSender<LinkEvent>,
    ) -> Result<(Link, Connected), LinkError> {
        let stream = match timeout(CONNECT_TIMEOUT, TcpStream::connect(addr)).await {
            Ok(Ok(stream)) => stream,
            Ok(Err(e)) => return Err(LinkError::Unreachable(e.to_string())),
            Err(_) => return Err(LinkError::Unreachable("timed out".into())),
        };
        let _ = stream.set_nodelay(true);
        let (read_half, mut writer) = stream.into_split();
        let mut reader = BufReader::new(read_half);

        let challenge = read_reply(&mut reader).await?;
        if kind_of(&challenge) != "challenge" {
            return Err(LinkError::Protocol("not a Selah desk".into()));
        }
        let nonce = challenge.get("nonce").and_then(Value::as_str).unwrap_or("");
        let hello = match &auth {
            Auth::Token(token) => json!({ "t": "hello", "v": PROTOCOL, "device": device, "user": user, "mac": proof(token, nonce) }),
            Auth::Code(code) => json!({ "t": "pair", "v": PROTOCOL, "device": device, "user": user, "code": code }),
        };
        write_frame(&mut writer, &hello.to_string()).await.map_err(|e| LinkError::Unreachable(e.to_string()))?;

        let mut token = None;
        let desk = loop {
            let reply = read_reply(&mut reader).await?;
            match kind_of(&reply) {
                "paired" => token = reply.get("token").and_then(Value::as_str).map(str::to_string),
                "ok" => break reply.get("desk").cloned().unwrap_or(Value::Null),
                "denied" => {
                    let reason = reply.get("reason").and_then(Value::as_str).unwrap_or("denied");
                    return Err(LinkError::Denied(reason.to_string()));
                }
                other => return Err(LinkError::Protocol(format!("unexpected {other:?}"))),
            }
        };

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let kick = Arc::new(Notify::new());
        let writing = tokio::spawn(async move {
            while let Some(text) = rx.recv().await {
                if write_frame(&mut writer, &text).await.is_err() {
                    break;
                }
            }
        });
        let pong = tx.clone();
        let stop = kick.clone();
        tokio::spawn(async move {
            let reason = loop {
                let line = tokio::select! {
                    read = timeout(SILENCE_LIMIT, read_frame(&mut reader)) => match read {
                        Ok(Ok(Some(line))) => line,
                        Ok(Ok(None)) => break "the desk closed the connection".to_string(),
                        Ok(Err(e)) => break e.to_string(),
                        Err(_) => break "the desk stopped answering".to_string(),
                    },
                    _ = stop.notified() => break "disconnected".to_string(),
                };
                if line == PING {
                    let _ = pong.send(PONG.to_string());
                    continue;
                }
                if line == PONG {
                    continue;
                }
                let _ = events.send(LinkEvent::Message(line));
            };
            writing.abort();
            let _ = events.send(LinkEvent::Closed(reason));
        });

        Ok((Link { tx, kick }, Connected { desk, token }))
    }

    /// Send a line to the desk. False once the link is closed.
    pub fn send(&self, text: String) -> bool {
        self.tx.send(text).is_ok()
    }
}

impl Drop for Link {
    fn drop(&mut self) {
        self.kick.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn desk() -> (Host, mpsc::UnboundedReceiver<HostEvent>, SocketAddr) {
        let (tx, rx) = mpsc::unbounded_channel();
        let host = Host::start(0, "Test desk".into(), Pairings::in_memory(), tx).await.expect("listen");
        let addr: SocketAddr = format!("127.0.0.1:{}", host.port()).parse().unwrap();
        (host, rx, addr)
    }

    fn phone(id: &str) -> Value {
        json!({ "id": id, "name": "Test phone" })
    }

    async fn next_event<T>(rx: &mut mpsc::UnboundedReceiver<T>) -> T {
        timeout(Duration::from_secs(5), rx.recv()).await.expect("an event").expect("open")
    }

    #[test]
    fn hmac_matches_the_rfc_4231_vector() {
        // RFC 4231, test case 2.
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(to_hex(&mac), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[tokio::test]
    async fn a_phone_pairs_with_the_code_then_reconnects_with_its_token() {
        let (host, mut desk_events, addr) = desk().await;
        let code = host.begin_pairing();

        let (phone_tx, mut phone_events) = mpsc::unbounded_channel();
        let (link, connected) = Link::connect(addr, phone("p1"), json!({ "id": "u1" }), Auth::Code(code), phone_tx)
            .await
            .expect("pair");
        let token = connected.token.expect("a token");
        assert_eq!(connected.desk["name"], "Test desk");
        assert_eq!(connected.desk["id"], host.desk_id());
        match next_event(&mut desk_events).await {
            HostEvent::Joined { device, user, paired_now, .. } => {
                assert_eq!(device["id"], "p1");
                assert_eq!(user["id"], "u1");
                assert!(paired_now);
            }
            other => panic!("expected a join, got {other:?}"),
        }
        assert_eq!(host.devices().len(), 1);

        // Messages flow both ways.
        assert!(link.send(r#"{"t":"cmd","k":"live"}"#.into()));
        match next_event(&mut desk_events).await {
            HostEvent::Message { text, .. } => assert_eq!(text, r#"{"t":"cmd","k":"live"}"#),
            other => panic!("expected a message, got {other:?}"),
        }
        host.broadcast(r#"{"t":"session"}"#);
        assert_eq!(next_event(&mut phone_events).await, LinkEvent::Message(r#"{"t":"session"}"#.into()));

        drop(link);
        assert!(matches!(next_event(&mut desk_events).await, HostEvent::Left { .. }));

        // Later, with no pairing window open: the token is enough.
        let (tx, _rx) = mpsc::unbounded_channel();
        let (_link, again) = Link::connect(addr, phone("p1"), Value::Null, Auth::Token(token), tx).await.expect("token");
        assert_eq!(again.token, None);
        assert!(matches!(next_event(&mut desk_events).await, HostEvent::Joined { paired_now: false, .. }));
    }

    #[tokio::test]
    async fn the_desk_turns_away_wrong_codes_unknown_tokens_and_forgotten_phones() {
        let (host, mut desk_events, addr) = desk().await;
        let connect = |id: &'static str, auth: Auth| async move {
            let (tx, _rx) = mpsc::unbounded_channel();
            Link::connect(addr, phone(id), Value::Null, auth, tx).await.map(|(link, c)| (link, c.token))
        };

        // No pairing window open.
        assert_eq!(connect("p1", Auth::Code("000000".into())).await.err(), Some(LinkError::Denied("not-pairing".into())));
        // A token the desk never gave out.
        assert_eq!(connect("p1", Auth::Token("00".repeat(32))).await.err(), Some(LinkError::Denied("unpaired".into())));

        // Five wrong codes close the window, so the right one no longer works.
        let code = host.begin_pairing();
        let wrong = if code == "123456" { "654321" } else { "123456" };
        for _ in 0..PAIRING_ATTEMPTS {
            assert_eq!(connect("p1", Auth::Code(wrong.into())).await.err(), Some(LinkError::Denied("code".into())));
        }
        assert_eq!(connect("p1", Auth::Code(code)).await.err(), Some(LinkError::Denied("not-pairing".into())));

        // Forgetting a phone disconnects it and its token stops working.
        let code = host.begin_pairing();
        let (_link, token) = connect("p2", Auth::Code(code)).await.expect("pair");
        assert!(matches!(next_event(&mut desk_events).await, HostEvent::Joined { .. }));
        assert!(host.forget("p2"));
        assert!(matches!(next_event(&mut desk_events).await, HostEvent::Left { .. }));
        assert_eq!(connect("p2", Auth::Token(token.unwrap())).await.err(), Some(LinkError::Denied("unpaired".into())));
    }

    #[tokio::test]
    async fn the_phone_hears_when_the_desk_goes_away() {
        let (host, _desk_events, addr) = desk().await;
        let code = host.begin_pairing();
        let (tx, mut phone_events) = mpsc::unbounded_channel();
        let (_link, _) = Link::connect(addr, phone("p1"), Value::Null, Auth::Code(code), tx).await.expect("pair");
        drop(host);
        assert!(matches!(next_event(&mut phone_events).await, LinkEvent::Closed(_)));
    }

    #[tokio::test]
    async fn something_that_isnt_a_desk_is_not_mistaken_for_one() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        });
        let (tx, _rx) = mpsc::unbounded_channel();
        let result = Link::connect(addr, phone("p1"), Value::Null, Auth::Code("1".into()), tx).await;
        assert!(matches!(result, Err(LinkError::Protocol(_))), "{:?}", result.err());
    }

    #[test]
    fn pairings_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!("selah-lan-pairings-{}", std::process::id()));
        let path = dir.join("lan-devices.json");
        let _ = std::fs::remove_dir_all(&dir);
        let (desk_id, token) = {
            let mut pairings = Pairings::load(path.clone());
            (pairings.desk_id().to_string(), pairings.add("p1", "Pixel"))
        };
        let pairings = Pairings::load(path);
        assert_eq!(pairings.desk_id(), desk_id);
        assert_eq!(pairings.token_for("p1"), Some(token));
        assert_eq!(pairings.devices()[0].name, "Pixel");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
