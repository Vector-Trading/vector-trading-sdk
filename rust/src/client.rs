use crate::{
    error::private_values, models::*, serialize_signal, validation, Error, ErrorKind, Result,
};
use reqwest::{
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Method, Url,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fmt,
    marker::PhantomData,
    net::IpAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

#[derive(Clone, Debug)]
pub struct ClientOptions {
    /// Bounds the entire operation, including streamed response bodies.
    pub timeout: Duration,
    /// Permits HTTP only for an explicitly selected loopback test receiver.
    pub allow_http_for_localhost: bool,
    /// Additional trusted CA for private deployments; TLS verification stays on.
    pub root_certificate: Option<reqwest::Certificate>,
}
impl Default for ClientOptions {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(10),
            allow_http_for_localhost: false,
            root_certificate: None,
        }
    }
}

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantOptions {
    #[serde(flatten)]
    pub page: PageOptions,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grant_type: Option<TradingBundleAccessGrantType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starts_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starts_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
}
struct Transport {
    http: reqwest::Client,
    base: Url,
    key: String,
    authorization: HeaderValue,
    closed: AtomicBool,
}
impl Transport {
    fn new(base: &str, key: &str, options: ClientOptions, strategy: bool) -> Result<Self> {
        let mut url = Url::parse(base).map_err(|_| Error::validation())?;
        let loopback = url.host_str().is_some_and(|s| {
            s == "localhost"
                || s.trim_matches(['[', ']'])
                    .parse::<IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        });
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || (url.scheme() != "https"
                && !(url.scheme() == "http" && options.allow_http_for_localhost && loopback))
            || options.timeout.is_zero()
            || key.is_empty()
            || key.chars().any(|c| c.is_control() || c.is_whitespace())
        {
            return Err(Error::validation());
        }
        if strategy
            && !(key.len() == 32
                && key
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
        {
            return Err(Error::validation());
        }
        let mut authorization =
            HeaderValue::from_str(&format!("Bearer {key}")).map_err(|_| Error::validation())?;
        authorization.set_sensitive(true);
        url.set_path(url.path().trim_end_matches('/').to_owned().as_str());
        let mut builder = reqwest::Client::builder()
            .timeout(options.timeout)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .http1_only()
            .pool_max_idle_per_host(0)
            .connection_verbose(false);
        if let Some(cert) = options.root_certificate {
            builder = builder.add_root_certificate(cert);
        }
        let http = builder.build().map_err(Error::network)?;
        Ok(Self {
            http,
            base: url,
            key: key.into(),
            authorization,
            closed: AtomicBool::new(false),
        })
    }
    fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }
    async fn request(
        &self,
        method: Method,
        path: &str,
        query: &[(String, String)],
        body: Option<Vec<u8>>,
        expected: u16,
        strategy: bool,
    ) -> Result<Vec<u8>> {
        if self.closed.load(Ordering::Acquire) {
            return Err(Error::new(ErrorKind::Closed, "Client is closed"));
        }
        let mut url = self.base.clone();
        url.set_path(&format!(
            "{}{}",
            self.base.path().trim_end_matches('/'),
            path
        ));
        let mut private = vec![self.key.clone(), url.to_string()];
        private.extend(query.iter().map(|(_, v)| v.clone()));
        if let Some(bytes) = &body {
            if let Ok(v) = serde_json::from_slice(bytes) {
                private_values(&v, &mut private);
            }
        }
        let mut request = self.http.request(method, url).query(query);
        if !strategy {
            request = request.header(AUTHORIZATION, self.authorization.clone());
        }
        if let Some(bytes) = body {
            request = request.header(CONTENT_TYPE, "application/json").body(bytes);
        }
        let mut response = request.send().await.map_err(Error::network)?;
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(Error::network)? {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err(Error::new(ErrorKind::Protocol, "Server body exceeds 1 MiB"));
            }
            bytes.extend_from_slice(&chunk);
        }
        if status != expected {
            if (200..300).contains(&status) {
                return Err(Error::new(ErrorKind::Protocol, "Unexpected success status"));
            }
            return Err(Error::response(
                status,
                &bytes,
                std::slice::from_ref(&self.key),
                &private,
            ));
        }
        Ok(bytes)
    }
}

/// Account-key REST client. Construction makes no requests.
#[derive(Clone)]
pub struct RestClient {
    transport: Arc<Transport>,
}
impl fmt::Debug for RestClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RestClient").finish_non_exhaustive()
    }
}
impl RestClient {
    pub fn new(base_url: &str, account_api_key: &str, options: ClientOptions) -> Result<Self> {
        Ok(Self {
            transport: Arc::new(Transport::new(base_url, account_api_key, options, false)?),
        })
    }
    /// Prevent further requests across clones. Drop pending futures to cancel
    /// in-flight requests, then drop all clones to release the managed client.
    pub fn close(&self) {
        self.transport.close();
    }
    async fn execute<T: DeserializeOwned>(
        &self,
        name: &str,
        path_values: &[(&str, &str)],
        query: Value,
        body: Option<Value>,
    ) -> Result<T> {
        let (method, template, op) = validation::operation(name);
        let mut path = template.to_owned();
        let q = query.as_object().ok_or_else(Error::validation)?;
        let parameters = op["parameters"].as_array().expect("generated parameters");
        for key in q.keys() {
            if !parameters
                .iter()
                .any(|p| p["in"] == "query" && p["name"] == key.as_str())
            {
                return Err(Error::validation());
            }
        }
        let mut pairs = Vec::new();
        for p in parameters {
            let key = p["name"].as_str().expect("generated parameter name");
            if p["in"] == "path" {
                let value = path_values
                    .iter()
                    .find(|(k, _)| *k == key)
                    .map(|(_, v)| *v)
                    .ok_or_else(Error::validation)?;
                if !validation::valid(&p["schema"], &json!(value)) {
                    return Err(Error::validation());
                }
                path = path.replace(&format!("{{{key}}}"), value);
            } else if let Some(value) = q.get(key) {
                if key == "cursor" {
                    if !value.is_string() {
                        return Err(Error::validation());
                    }
                } else if !validation::valid(&p["schema"], value) {
                    return Err(Error::validation());
                }
                pairs.push((
                    key.to_owned(),
                    value
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| value.to_string()),
                ));
            } else if p["required"] == true {
                return Err(Error::validation());
            }
        }
        let bytes = if let Some(value) = body {
            let schema = &op["requestBody"]["content"]["application/json"]["schema"];
            if !validation::valid(schema, &value) {
                return Err(Error::validation());
            }
            Some(serde_json::to_vec(&value).map_err(|_| Error::validation())?)
        } else {
            None
        };
        let bytes = self
            .transport
            .request(
                Method::from_bytes(method.to_ascii_uppercase().as_bytes())
                    .map_err(|_| Error::validation())?,
                &path,
                &pairs,
                bytes,
                200,
                false,
            )
            .await?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| Error::new(ErrorKind::Protocol, "Server response is not JSON"))?;
        let schema = &op["responses"]["200"]["content"]["application/json"]["schema"];
        if !validation::valid(schema, &value) {
            return Err(Error::new(
                ErrorKind::Protocol,
                "Server response does not match the public contract",
            ));
        }
        serde_json::from_value(value)
            .map_err(|_| Error::new(ErrorKind::Protocol, "Cannot decode server response model"))
    }
    pub async fn list_bundles(&self, options: PageOptions) -> Result<BundlesResponse> {
        self.execute("listBundles", &[], encode(options)?, None)
            .await
    }
    pub async fn search_users(
        &self,
        display_name: &str,
        options: PageOptions,
    ) -> Result<UsersSearchResponse> {
        let mut q = encode(options)?;
        q["displayName"] = display_name.into();
        self.execute("searchUsers", &[], q, None).await
    }
    pub async fn get_checkout(&self, checkout_id: &str) -> Result<CheckoutDetails> {
        self.execute(
            "getCheckout",
            &[("checkoutId", checkout_id)],
            json!({}),
            None,
        )
        .await
    }
    pub async fn list_bundle_users(
        &self,
        bundle_id: &str,
        options: PageOptions,
    ) -> Result<BundleUsersResponse> {
        self.execute(
            "listBundleUsers",
            &[("bundleId", bundle_id)],
            encode(options)?,
            None,
        )
        .await
    }
    pub async fn list_bundle_grants(
        &self,
        bundle_id: &str,
        options: GrantOptions,
    ) -> Result<BundleGrantsResponse> {
        self.execute(
            "listBundleGrants",
            &[("bundleId", bundle_id)],
            encode(options)?,
            None,
        )
        .await
    }
    pub async fn create_bundle_grant<T: Serialize>(
        &self,
        bundle_id: &str,
        grant: &T,
    ) -> Result<GrantMutationResponse> {
        self.execute(
            "createBundleGrant",
            &[("bundleId", bundle_id)],
            json!({}),
            Some(encode(grant)?),
        )
        .await
    }
    /// Server cascading revocation semantics apply; no implicit retry occurs.
    pub async fn revoke_bundle_grant(
        &self,
        bundle_id: &str,
        grant_id: &str,
    ) -> Result<GrantMutationResponse> {
        self.execute(
            "revokeBundleGrant",
            &[("bundleId", bundle_id), ("grantId", grant_id)],
            json!({}),
            None,
        )
        .await
    }
    pub fn bundles_pages(&self, options: PageOptions) -> Result<Pages<BundlesResponse>> {
        Pages::new(self.clone(), "listBundles", vec![], encode(options)?)
    }
    pub fn users_pages(
        &self,
        display_name: &str,
        options: PageOptions,
    ) -> Result<Pages<UsersSearchResponse>> {
        let mut q = encode(options)?;
        q["displayName"] = display_name.into();
        Pages::new(self.clone(), "searchUsers", vec![], q)
    }
    pub fn bundle_users_pages(
        &self,
        bundle_id: &str,
        options: PageOptions,
    ) -> Result<Pages<BundleUsersResponse>> {
        Pages::new(
            self.clone(),
            "listBundleUsers",
            vec![("bundleId", bundle_id.into())],
            encode(options)?,
        )
    }
    pub fn bundle_grants_pages(
        &self,
        bundle_id: &str,
        options: GrantOptions,
    ) -> Result<Pages<BundleGrantsResponse>> {
        Pages::new(
            self.clone(),
            "listBundleGrants",
            vec![("bundleId", bundle_id.into())],
            encode(options)?,
        )
    }
}
fn encode<T: Serialize>(v: T) -> Result<Value> {
    serde_json::to_value(v).map_err(|_| Error::validation())
}

/// Lazy page traversal. An empty page with a cursor still has a continuation.
pub struct Pages<T> {
    client: RestClient,
    operation: &'static str,
    path: Vec<(&'static str, String)>,
    query: Value,
    seen: HashSet<String>,
    done: bool,
    marker: PhantomData<T>,
}
impl<T: DeserializeOwned> Pages<T> {
    fn new(
        client: RestClient,
        operation: &'static str,
        path: Vec<(&'static str, String)>,
        query: Value,
    ) -> Result<Self> {
        let mut seen = HashSet::new();
        if let Some(s) = query["cursor"].as_str() {
            seen.insert(s.to_owned());
        }
        Ok(Self {
            client,
            operation,
            path,
            query,
            seen,
            done: false,
            marker: PhantomData,
        })
    }
    pub async fn next(&mut self) -> Result<Option<T>> {
        if self.done {
            return Ok(None);
        }
        let path: Vec<_> = self.path.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let value: Value = self
            .client
            .execute(self.operation, &path, self.query.clone(), None)
            .await?;
        let page = serde_json::from_value(value.clone())
            .map_err(|_| Error::new(ErrorKind::Protocol, "Cannot decode page"))?;
        if let Some(cursor) = value["nextCursor"].as_str() {
            if !self.seen.insert(cursor.into()) {
                self.done = true;
                return Err(Error::new(
                    ErrorKind::Pagination,
                    "Server repeated a pagination cursor",
                ));
            }
            self.query["cursor"] = cursor.into();
        } else {
            self.done = true;
        }
        Ok(Some(page))
    }
}

/// Strategy-key webhook client. Never uses account Authorization headers.
#[derive(Clone)]
pub struct SignalsClient {
    transport: Arc<Transport>,
}
impl fmt::Debug for SignalsClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SignalsClient").finish_non_exhaustive()
    }
}
impl SignalsClient {
    pub fn new(base_url: &str, strategy_api_key: &str, options: ClientOptions) -> Result<Self> {
        Ok(Self {
            transport: Arc::new(Transport::new(base_url, strategy_api_key, options, true)?),
        })
    }
    pub fn close(&self) {
        self.transport.close();
    }
    /// `Ok(())` means enqueue acceptance (204), not an executed trade.
    pub async fn send<T: Serialize + ?Sized>(&self, signal: &T) -> Result<()> {
        let bytes = serialize_signal(signal)?;
        self.transport
            .request(
                Method::POST,
                &format!("/webhooks/signals/v1/{}", self.transport.key),
                &[],
                Some(bytes),
                204,
                true,
            )
            .await?;
        Ok(())
    }
}
