use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    Validation,
    Http,
    Transport,
    Timeout,
    Protocol,
    Pagination,
    Closed,
}

/// Bounded diagnostics without retained request bodies, URLs, or raw causes.
#[derive(Clone, Debug)]
pub struct Error {
    pub kind: ErrorKind,
    pub message: String,
    pub status: Option<u16>,
    pub code: Option<String>,
    pub request_id: Option<String>,
}
impl Error {
    pub(crate) fn new(kind: ErrorKind, message: &str) -> Self {
        Self {
            kind,
            message: message.into(),
            status: None,
            code: None,
            request_id: None,
        }
    }
    pub(crate) fn validation() -> Self {
        Self::new(
            ErrorKind::Validation,
            "Input does not match the public contract",
        )
    }
    pub(crate) fn network(error: reqwest::Error) -> Self {
        if error.is_timeout() {
            Self::new(
                ErrorKind::Timeout,
                "HTTP operation timed out; remote outcome may be unknown",
            )
        } else {
            Self::new(
                ErrorKind::Transport,
                "HTTP operation failed; remote outcome may be unknown",
            )
        }
    }
    pub(crate) fn response(
        status: u16,
        bytes: &[u8],
        secrets: &[String],
        private: &[String],
    ) -> Self {
        let mut e = Self::new(ErrorKind::Http, "HTTP request failed");
        e.status = Some(status);
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(bytes) {
            if let Some(s) = v["message"].as_str().or_else(|| v["error"].as_str()) {
                e.message = safe_text(s, private);
            }
            e.code = v["errorCode"].as_str().map(|s| safe_text(s, secrets));
            e.request_id = v["requestId"].as_str().map(|s| safe_text(s, secrets));
        }
        e
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}
impl std::error::Error for Error {}

fn safe_text(input: &str, secrets: &[String]) -> String {
    let mut text = input.to_owned();
    for secret in secrets.iter().filter(|s| !s.is_empty()) {
        text = text.replace(secret, "[redacted]");
    }
    // Treat URL/token-like words conservatively; never reproduce private URLs.
    text.split_whitespace()
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            if lower.contains("http://")
                || lower.contains("https://")
                || word.contains("vt_")
                || word.as_bytes().windows(32).any(|w| {
                    w.iter()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                })
            {
                "[redacted]".to_owned()
            } else {
                word.chars()
                    .map(|c| if c.is_control() { ' ' } else { c })
                    .collect()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(512)
        .collect()
}

pub(crate) fn private_values(v: &serde_json::Value, result: &mut Vec<String>) {
    match v {
        serde_json::Value::String(s) => result.push(s.clone()),
        serde_json::Value::Array(xs) => xs.iter().for_each(|x| private_values(x, result)),
        serde_json::Value::Object(xs) => xs.values().for_each(|x| private_values(x, result)),
        _ => {}
    }
}
