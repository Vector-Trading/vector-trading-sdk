//! Asynchronous Vector Trading clients and offline signal builders.
//!
//! ```
//! use vector_trading_sdk::{build_update_signal, serialize_signal, SignalOptions, models};
//! let mut order = models::UpdateSignalPayloadOrder::new(
//!     models::update_signal_payload_order::Side::Buy);
//! order.take_profits = Some(vec![]); // Explicitly clear existing targets.
//! let signal = build_update_signal(1.0, 100.0, order, SignalOptions::default())?;
//! let body = serialize_signal(&signal)?;
//! assert!(String::from_utf8(body)?.contains("\"takeProfits\":[]"));
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//! Requests need a Tokio execution context. Dropping a pending request future
//! cancels local waiting; a mutation may already have been accepted remotely.

mod client;
mod error;
// Scope upstream template style exceptions to derived models only.
#[allow(unused_imports, clippy::derivable_impls, clippy::empty_docs)]
#[path = "../generated/src/models/mod.rs"]
pub mod models;
mod signals;
mod validation;

pub use client::{ClientOptions, GrantOptions, PageOptions, Pages, RestClient, SignalsClient};
pub use error::{Error, ErrorKind, Result};
pub use signals::*;

/// Package guide with checked code examples.
#[doc = include_str!("../README.md")]
pub mod guide {}
