use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
#[derive(Default)]
pub struct ProviderLimits(Mutex<Option<RateState>>);
#[derive(Default, Serialize, Deserialize)]
struct RateState(HashMap<String, Bucket>);
#[derive(Default, Serialize, Deserialize)]
struct Bucket {
    calls: Vec<u64>,
    blocked_until: u64,
}
impl RateState {
    fn consume(&mut self, key: &str, now: u64) -> Result<(), String> {
        self.0.retain(|_, b| {
            b.blocked_until > now || b.calls.iter().any(|t| now.saturating_sub(*t) < 60)
        });
        if !self.0.contains_key(key) && self.0.len() >= 4096 {
            return Err("Provider limiter capacity reached".into());
        }
        let bucket = self.0.entry(key.to_string()).or_default();
        bucket.calls.retain(|t| now.saturating_sub(*t) < 60);
        // Conservative shared per-Item cap: accounts/get and item/get permit 15/minute.
        if bucket.blocked_until > now || bucket.calls.len() >= 15 {
            return Err("Provider request limit reached. Wait one minute.".into());
        }
        bucket.calls.push(now);
        Ok(())
    }
    fn persist(&self, path: &Path) -> Result<(), String> {
        let bytes = serde_json::to_vec(self).map_err(|_| "Provider limiter unavailable")?;
        let pending = path.with_extension("pending");
        fs::write(&pending, bytes).map_err(|_| "Could not persist provider limits")?;
        fs::rename(pending, path).map_err(|_| "Could not persist provider limits".into())
    }
    fn load(path: &Path) -> Result<Self, String> {
        match fs::metadata(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("Could not read provider limits".into()),
            Ok(m) if m.len() > 2 * 1024 * 1024 => Err("Provider limits file is too large".into()),
            Ok(_) => serde_json::from_slice(
                &fs::read(path).map_err(|_| "Could not read provider limits")?,
            )
            .map_err(|_| "Provider limits file is damaged; restore it before gathering".into()),
        }
    }
}
fn now_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs())
        .map_err(|_| "System clock is invalid".into())
}

fn endpoint_allowed(endpoint: &str) -> bool {
    matches!(
        endpoint,
        "/link/token/create"
            | "/link/token/get"
            | "/item/public_token/exchange"
            | "/item/get"
            | "/item/remove"
            | "/accounts/get"
            | "/transactions/get"
            | "/liabilities/get"
    )
}
#[tauri::command]
pub async fn plaid_request(
    environment: String,
    endpoint: String,
    body: Value,
    limits: State<'_, ProviderLimits>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let host = match environment.as_str() {
        "sandbox" => "sandbox.plaid.com",
        "production" => "production.plaid.com",
        _ => return Err("Unsupported provider environment".into()),
    };
    if !endpoint_allowed(&endpoint) {
        return Err("Provider endpoint is not allowed".into());
    }
    if !body.is_object() || body.to_string().len() > 1024 * 1024 {
        return Err("Invalid provider request".into());
    }
    let item = body
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or("link");
    let key = format!("{}:{:x}", host, Sha256::digest(item.as_bytes()));
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Provider storage unavailable")?;
    fs::create_dir_all(&dir).map_err(|_| "Provider storage unavailable")?;
    let path = dir.join("provider-limits.json");
    {
        let mut state = limits
            .0
            .lock()
            .map_err(|_| "Provider limiter unavailable")?;
        if state.is_none() {
            *state = Some(RateState::load(&path)?);
        }
        let counters = state.as_mut().ok_or("Provider limiter unavailable")?;
        counters.consume(&key, now_seconds()?)?;
        // Persist before sending: a crash or failed response never resets the count.
        counters.persist(&path)?;
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Provider connection could not be created")?;
    let mut response = client
        .post(format!("https://{}{}", host, endpoint))
        .json(&body)
        .send()
        .await
        .map_err(|_| "Provider connection failed")?;
    if response.status().is_redirection() {
        return Err("Provider redirects are not permitted".into());
    }
    if response.content_length().unwrap_or(0) > 20 * 1024 * 1024 {
        return Err("Provider response is too large".into());
    }
    let status = response.status();
    if status.as_u16() == 429 {
        let retry = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(60)
            .clamp(60, 3600);
        let mut state = limits
            .0
            .lock()
            .map_err(|_| "Provider limiter unavailable")?;
        let counters = state.as_mut().ok_or("Provider limiter unavailable")?;
        counters.0.entry(key.clone()).or_default().blocked_until =
            now_seconds()?.saturating_add(retry);
        counters.persist(&path)?;
        return Err("Provider rate limit reached. Try again after the cooldown.".into());
    }
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Provider response interrupted")?
    {
        if data.len() + chunk.len() > 20 * 1024 * 1024 {
            return Err("Provider response is too large".into());
        }
        data.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        let value: Value = serde_json::from_slice(&data).unwrap_or(Value::Null);
        let code = value
            .get("error_code")
            .and_then(Value::as_str)
            .unwrap_or("PROVIDER_ERROR");
        let safe: String = code
            .chars()
            .filter(|c| c.is_ascii_uppercase() || *c == '_')
            .take(80)
            .collect();
        return Err(safe);
    }
    String::from_utf8(data).map_err(|_| "Provider response is not UTF-8".into())
}
#[tauri::command]
pub fn open_hosted_link(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid Hosted Link URL")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("secure.plaid.com")
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Hosted Link URL is not allowed".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg(url)
            .spawn()
            .map_err(|_| "Could not open Hosted Link")?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Hosted Link is supported on macOS in this release".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_survive_restart_and_keep_no_credentials() {
        let path = std::env::temp_dir().join(format!(
            "pt-provider-limits-{}-{}.json",
            std::process::id(),
            now_seconds().unwrap()
        ));
        let mut state = RateState::default();
        let key = format!(
            "production.plaid.com:{:x}",
            Sha256::digest(b"CANARY_ACCESS_TOKEN")
        );
        for _ in 0..15 {
            state.consume(&key, 1000).unwrap();
        }
        state.persist(&path).unwrap();
        let bytes = fs::read_to_string(&path).unwrap();
        assert!(!bytes.contains("CANARY_ACCESS_TOKEN"));
        let mut restored = RateState::load(&path).unwrap();
        assert!(restored.consume(&key, 1010).is_err());
        assert!(restored.consume(&key, 900).is_err()); // Clock rollback cannot reset the bucket.
        assert!(restored.consume(&key, 1060).is_ok());
        restored.0.get_mut(&key).unwrap().blocked_until = 1200;
        restored.persist(&path).unwrap();
        let mut restored = RateState::load(&path).unwrap();
        assert!(restored.consume(&key, 1120).is_err());
        assert!(restored.consume(&key, 1200).is_ok());
        fs::write(&path, b"corrupt").unwrap();
        assert!(RateState::load(&path).is_err());
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn allowlist() {
        assert!(endpoint_allowed("/transactions/get"));
        assert!(!endpoint_allowed("https://evil.test"));
        assert!(!endpoint_allowed("/transactions/get/../"));
        assert!(!endpoint_allowed("/transfer/create"));
    }
}
