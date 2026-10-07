//! Portable machine requirement syntax; discovery and process execution belong to the server.
#[derive(Debug, PartialEq)]
pub enum Requirement<'a> {
    Program {
        name: &'a str,
        minimum: Option<Vec<u32>>,
    },
    PythonModule {
        interpreter: &'a str,
        module: &'a str,
    },
}
impl<'a> Requirement<'a> {
    pub fn parse(value: &'a str) -> Result<Self, String> {
        let name = |s: &str| {
            !s.is_empty()
                && s.len() <= 128
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
                && !s.starts_with(['-', '.'])
        };
        if let Some((interpreter, module)) = value.split_once(':') {
            if !name(interpreter)
                || !interpreter.starts_with("python")
                || !module.split('.').all(|part| {
                    !part.is_empty()
                        && part.bytes().enumerate().all(|(i, c)| {
                            c == b'_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit())
                        })
                })
            {
                return Err(format!("Invalid Python requirement: {value}"));
            }
            return Ok(Self::PythonModule {
                interpreter,
                module,
            });
        }
        let (program, version) = value
            .split_once(">=")
            .map_or((value, None), |(p, v)| (p, Some(v)));
        if !name(program) {
            return Err(format!("Invalid program requirement: {value}"));
        }
        let minimum = version
            .map(|v| {
                let parts: Result<Vec<u32>, _> = v.split('.').map(str::parse).collect();
                parts
                    .ok()
                    .filter(|v| !v.is_empty() && v.len() <= 4)
                    .ok_or_else(|| format!("Invalid minimum version: {value}"))
            })
            .transpose()?;
        Ok(Self::Program {
            name: program,
            minimum,
        })
    }
}
pub fn validate(requirements: &[String]) -> Result<(), String> {
    if requirements.len() > 32 {
        return Err("At most 32 machine requirements are allowed".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    for value in requirements {
        if value.len() > 256 || !seen.insert(value) {
            return Err("Machine requirements must be unique and at most 256 bytes".into());
        }
        Requirement::parse(value)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requirements_are_literal_and_portable() {
        for value in [
            "ffmpeg",
            "blender>=5.0",
            "python3:numpy",
            "python3:xml.etree",
        ] {
            assert!(Requirement::parse(value).is_ok(), "{value}");
        }
        for value in [
            "--help",
            "/usr/bin/python3",
            "ffmpeg;touch x",
            "blender>=",
            "blender>=x",
            "node:fs",
            "python3:a..b",
            "python3:x()",
        ] {
            assert!(Requirement::parse(value).is_err(), "{value}");
        }
    }
}
