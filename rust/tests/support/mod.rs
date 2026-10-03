#![allow(dead_code)]
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    pub target: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}
impl Request {
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap()
    }
    pub fn query(&self) -> BTreeMap<String, String> {
        reqwest::Url::parse(&format!("http://localhost{}", self.target))
            .unwrap()
            .query_pairs()
            .map(|(k, v)| (k.into(), v.into()))
            .collect()
    }
}
pub enum Reply {
    Normal(u16, String, Vec<u8>),
    Delay(Duration, Box<Reply>),
    Stream(Duration),
    Lost,
}
impl Reply {
    pub fn json(v: &serde_json::Value) -> Self {
        Self::Normal(200, String::new(), serde_json::to_vec(v).unwrap())
    }
    pub fn status(s: u16) -> Self {
        Self::Normal(s, String::new(), vec![])
    }
    fn send(self, stream: &mut impl Write) {
        match self {
            Self::Normal(status, headers, body) => {
                let _ = write!(stream, "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n", body.len());
                let _ = stream.write_all(&body);
                let _ = stream.flush();
            }
            Self::Delay(delay, reply) => {
                thread::sleep(delay);
                reply.send(stream);
            }
            Self::Stream(delay) => {
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{",
                );
                let _ = stream.flush();
                thread::sleep(delay);
            }
            Self::Lost => {}
        }
    }
}
fn read(stream: &mut impl Read) -> Request {
    let mut bytes = vec![];
    let mut b = [0];
    while !bytes.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut b).unwrap();
        bytes.push(b[0]);
        assert!(bytes.len() < 64 * 1024);
    }
    let text = String::from_utf8(bytes).unwrap();
    let mut lines = text.split("\r\n");
    let mut first = lines.next().unwrap().split_whitespace();
    let method = first.next().unwrap().into();
    let target = first.next().unwrap().into();
    let headers: BTreeMap<String, String> = lines
        .filter_map(|l| {
            l.split_once(':')
                .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().into()))
        })
        .collect();
    let size = headers
        .get("content-length")
        .map_or(0, |v| v.parse().unwrap());
    let mut body = vec![0; size];
    stream.read_exact(&mut body).unwrap();
    Request {
        method,
        target,
        headers,
        body,
    }
}
pub struct Server {
    pub url: String,
    pub requests: Arc<Mutex<Vec<Request>>>,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}
impl Server {
    pub fn new(handler: impl Fn(&Request) -> Reply + Send + Sync + 'static) -> Self {
        Self::start(handler, None)
    }
    pub fn tls(
        handler: impl Fn(&Request) -> Reply + Send + Sync + 'static,
    ) -> (Self, reqwest::Certificate) {
        let key = rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()])
            .unwrap();
        let cert = reqwest::Certificate::from_der(key.cert.der()).unwrap();
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let mut config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![key.cert.der().clone()],
                rustls::pki_types::PrivatePkcs8KeyDer::from(key.signing_key.serialize_der()).into(),
            )
            .unwrap();
        config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
        (Self::start(handler, Some(Arc::new(config))), cert)
    }
    fn start(
        handler: impl Fn(&Request) -> Reply + Send + Sync + 'static,
        tls: Option<Arc<rustls::ServerConfig>>,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!(
            "{}://{}",
            if tls.is_some() { "https" } else { "http" },
            listener.local_addr().unwrap()
        );
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let requests = Arc::new(Mutex::new(vec![]));
        let captured = requests.clone();
        let handler = Arc::new(handler);
        let join = thread::spawn(move || {
            let mut workers = vec![];
            while !stopped.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let captured = captured.clone();
                        let handler = handler.clone();
                        let tls = tls.clone();
                        workers.push(thread::spawn(move || {
                            stream.set_nonblocking(false).unwrap();
                            stream
                                .set_read_timeout(Some(Duration::from_secs(3)))
                                .unwrap();
                            stream
                                .set_write_timeout(Some(Duration::from_secs(3)))
                                .unwrap();
                            if let Some(config) = tls {
                                let connection = rustls::ServerConnection::new(config).unwrap();
                                let mut stream = rustls::StreamOwned::new(connection, stream);
                                let request = read(&mut stream);
                                assert!(stream
                                    .conn
                                    .alpn_protocol()
                                    .is_none_or(|p| p == b"http/1.1"));
                                captured.lock().unwrap().push(request.clone());
                                handler(&request).send(&mut stream);
                            } else {
                                let request = read(&mut stream);
                                captured.lock().unwrap().push(request.clone());
                                handler(&request).send(&mut stream);
                            }
                        }));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2))
                    }
                    Err(e) => panic!("{e}"),
                }
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        Self {
            url,
            requests,
            stop,
            join: Some(join),
        }
    }
    pub fn count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(join) = self.join.take() {
            let result = join.join();
            if !thread::panicking() {
                result.unwrap();
            }
        }
    }
}
pub fn options() -> vector_trading_sdk::ClientOptions {
    vector_trading_sdk::ClientOptions {
        allow_http_for_localhost: true,
        ..Default::default()
    }
}
pub const ACCOUNT: &str = "vt_synthetic_account_key";
pub const STRATEGY: &str = "7ab97361321c46f2bc7300a04fd6d133";
pub const BUNDLE: &str = "2be97361321c46f2bc7300a04fd6d133";
pub const GRANT: &str = "5ee97361321c46f2bc7300a04fd6d466";
pub fn rest_cases() -> Vec<serde_json::Value> {
    serde_json::from_str(include_str!("../../../conformance/rest/cases.json")).unwrap()
}
pub fn signal_cases() -> Vec<serde_json::Value> {
    serde_json::from_str(include_str!("../../../conformance/signals/cases.json")).unwrap()
}
