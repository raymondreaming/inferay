use serde::{Serialize, de::DeserializeOwned};
use std::fmt::Display;

pub(crate) fn parse<T: DeserializeOwned>(input: &str) -> Result<T, String> {
    serde_json::from_str(input).map_err(error)
}

pub(crate) fn stringify<T: Serialize>(value: &T, context: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|error| panic!("{context}: {error}"))
}

pub(crate) fn result<T, E: Display>(result: Result<T, E>) -> Result<T, String> {
    result.map_err(error)
}

fn error(error: impl Display) -> String {
    error.to_string()
}
