use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::State;
#[derive(Default)]
pub struct ProviderLimits(pub Mutex<HashMap<String, Vec<Instant>>>);
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
    {
        let mut state = limits
            .0
            .lock()
            .map_err(|_| "Provider limiter unavailable")?;
        let now = Instant::now();
        let calls = state.entry(key).or_default();
        calls.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
        if calls.len() >= 30 {
            return Err("Provider request limit reached. Wait one minute.".into());
        }
        calls.push(now);
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
    fn allowlist() {
        assert!(endpoint_allowed("/transactions/get"));
        assert!(!endpoint_allowed("https://evil.test"));
        assert!(!endpoint_allowed("/transactions/get/../"));
        assert!(!endpoint_allowed("/transfer/create"));
    }
}
