use serde_json::{Value, json};

pub fn source(input: &Value) -> Value {
    let Some(href) = input.get("href").and_then(Value::as_str) else {
        return Value::Null;
    };
    let path = if let Some(file) = href.strip_prefix("file:") {
        let file = file.split(['?', '#']).next().unwrap_or_default();
        let file = file.strip_prefix("//").unwrap_or(file);
        let encoded_path = if let Some(rest) = file.strip_prefix("localhost/") {
            format!("/{rest}")
        } else if file.starts_with('/') && !file.starts_with("//") {
            file.to_owned()
        } else {
            return Value::Null;
        };
        let Some(decoded) = percent_decode(&encoded_path) else {
            return Value::Null;
        };
        decoded
    } else if let Some(path) = href.strip_prefix("sandbox:") {
        path.to_owned()
    } else {
        href.to_owned()
    };
    if path.starts_with('/') && !path.starts_with("//") && !path.starts_with("/api/") {
        json!(format!("/api/file?path={}", url_encode(&path)))
    } else {
        json!(path)
    }
}

fn percent_decode(value: &str) -> Option<String> {
    let mut output = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let encoded = bytes.get(index + 1..index + 3)?;
            output.push(u8::from_str_radix(std::str::from_utf8(encoded).ok()?, 16).ok()?);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}

fn url_encode(value: &str) -> String {
    value.bytes().fold(String::new(), |mut output, byte| {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(byte as char);
        } else {
            use std::fmt::Write;
            write!(output, "%{byte:02X}").expect("string write");
        }
        output
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rewrites_local_image_sources() {
        assert_eq!(
            source(&json!({"href":"/tmp/a b.png"})),
            json!("/api/file?path=%2Ftmp%2Fa%20b.png")
        );
        assert_eq!(
            source(&json!({"href":"sandbox:/tmp/a.png"})),
            json!("/api/file?path=%2Ftmp%2Fa.png")
        );
        assert_eq!(
            source(&json!({"href":"https://example.com/a.png"})),
            json!("https://example.com/a.png")
        );
        assert_eq!(source(&json!({"href":"file://remote/a.png"})), Value::Null);
    }
}
