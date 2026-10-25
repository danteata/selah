//! Selah on the local network.
//!
//! The desk's computer announces itself over mDNS (Bonjour) as a
//! `_selah._tcp` service, and a phone on the same Wi-Fi finds it without
//! anyone typing an address. This is the discovery half of a local transport
//! for live sessions: Convex stays the record and the fallback, while a phone
//! next to the desk talks to it directly (see docs/LAN_SESSIONS.md).

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;

/// The service type every Selah desk announces.
pub const SERVICE_TYPE: &str = "_selah._tcp.local.";

pub type Error = mdns_sd::Error;

/// A desk found on the network.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Desk {
    /// The desk's own name for itself ("Main desk").
    pub name: String,
    pub host: String,
    pub addresses: Vec<String>,
    pub port: u16,
    /// What the desk chose to say about itself: its church, app version.
    pub properties: HashMap<String, String>,
}

/// A running announcement. Dropping it takes the desk off the network.
pub struct Announcement {
    daemon: ServiceDaemon,
    fullname: String,
}

impl Announcement {
    pub fn fullname(&self) -> &str {
        &self.fullname
    }
}

impl Drop for Announcement {
    fn drop(&mut self) {
        // Say goodbye, so phones drop the desk now rather than when its
        // record expires.
        if let Ok(done) = self.daemon.unregister(&self.fullname) {
            let _ = done.recv_timeout(Duration::from_millis(500));
        }
        let _ = self.daemon.shutdown();
    }
}

/// mDNS host names are one DNS label under `.local.`: letters, digits, hyphens.
fn host_label(name: &str) -> String {
    let label: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let label = label.trim_matches('-');
    if label.is_empty() { "selah-desk".to_string() } else { label.to_string() }
}

/// Announce this computer as a Selah desk named `name`, serving on `port`.
pub fn announce(name: &str, port: u16, properties: &[(&str, &str)]) -> Result<Announcement, Error> {
    let daemon = ServiceDaemon::new()?;
    let host = format!("{}.local.", host_label(name));
    let info = ServiceInfo::new(SERVICE_TYPE, name, &host, "", port, properties)?.enable_addr_auto();
    let fullname = info.get_fullname().to_string();
    daemon.register(info)?;
    Ok(Announcement { daemon, fullname })
}

/// Look for desks for up to `timeout`, returning what answered, by name.
pub fn discover(timeout: Duration) -> Result<Vec<Desk>, Error> {
    let daemon = ServiceDaemon::new()?;
    let events = daemon.browse(SERVICE_TYPE)?;
    let deadline = Instant::now() + timeout;
    let mut found: HashMap<String, Desk> = HashMap::new();

    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match events.recv_timeout(left) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let mut addresses: Vec<IpAddr> = info.get_addresses().iter().map(|a| a.to_ip_addr()).collect();
                // IPv4 first: it's what a phone on church Wi-Fi reaches.
                addresses.sort_by_key(|a| !a.is_ipv4());
                let name = info
                    .get_fullname()
                    .strip_suffix(&format!(".{SERVICE_TYPE}"))
                    .unwrap_or(info.get_fullname())
                    .to_string();
                let properties = info
                    .get_properties()
                    .iter()
                    .map(|p| (p.key().to_string(), p.val_str().to_string()))
                    .collect();
                found.insert(name.clone(), Desk {
                    name,
                    host: info.get_hostname().to_string(),
                    addresses: addresses.iter().map(|a| a.to_string()).collect(),
                    port: info.get_port(),
                    properties,
                });
            }
            Ok(_) => {}
            Err(_) => break, // timed out
        }
    }

    let _ = daemon.stop_browse(SERVICE_TYPE);
    let _ = daemon.shutdown();
    let mut desks: Vec<Desk> = found.into_values().collect();
    desks.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(desks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_labels_are_dns_safe() {
        assert_eq!(host_label("Main Desk (Sanctuary)"), "main-desk--sanctuary");
        assert_eq!(host_label("!!!"), "selah-desk");
    }

    #[test]
    fn a_phone_finds_the_desk_that_announced_itself() {
        let name = format!("Test desk {}", std::process::id());
        let _desk = announce(&name, 17494, &[("church", "c1"), ("v", "0.1.41")]).expect("announce");
        let desks = discover(Duration::from_secs(3)).expect("discover");
        let desk = desks.iter().find(|d| d.name == name).unwrap_or_else(|| panic!("not found in {desks:?}"));
        assert_eq!(desk.port, 17494);
        assert_eq!(desk.properties.get("church").map(String::as_str), Some("c1"));
        assert!(!desk.addresses.is_empty());
    }
}
