//! Small bounded KeyValues parser: quoted/unquoted values, comments, nested objects and escapes.
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
/// A parsed KeyValues string or object; parser limits bound nesting and input size.
pub enum Value {
    Text(String),
    Object(BTreeMap<String, Value>),
}
impl Value {
    /// Return the child at `key` for an object, or None for a missing key or text value.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Self::Object(m) => m.get(key),
            _ => None,
        }
    }
    /// Borrow the contained text, or return None when this value is an object.
    pub fn text(&self) -> Option<&str> {
        match self {
            Self::Text(s) => Some(s),
            _ => None,
        }
    }
    /// Return borrowed child values for an object; text values yield an empty vector.
    pub fn values(&self) -> Vec<&Value> {
        match self {
            Self::Object(m) => m.values().collect(),
            _ => vec![],
        }
    }
}
/// Parse KeyValues `input` into an owned tree with size/depth limits. Malformed strings, braces and missing values return descriptive errors.
pub fn parse(input: &str) -> Result<Value, String> {
    if input.len() > 8 * 1024 * 1024 {
        return Err("Manifest ist zu groß".into());
    }
    let mut chars = input.trim_start_matches('\u{feff}').chars().peekable();
    let mut tokens: Vec<String> = vec![];
    while let Some(ch) = chars.next() {
        if ch.is_whitespace() {
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'/') {
            for c in chars.by_ref() {
                if c == '\n' {
                    break;
                }
            }
            continue;
        }
        if ch == '{' || ch == '}' {
            tokens.push(ch.to_string());
            continue;
        }
        let mut word = String::new();
        if ch == '"' {
            let mut closed = false;
            while let Some(c) = chars.next() {
                if c == '"' {
                    closed = true;
                    break;
                }
                if c == '\\' {
                    let next = chars.next().ok_or("Unvollständige Escape-Sequenz")?;
                    if next != '\\' && next != '"' {
                        word.push('\\');
                    }
                    word.push(next);
                } else {
                    word.push(c);
                }
            }
            if !closed {
                return Err("Unvollständige Zeichenkette".into());
            }
        } else {
            word.push(ch);
            while chars
                .peek()
                .is_some_and(|c| !c.is_whitespace() && *c != '{' && *c != '}')
            {
                word.push(chars.next().unwrap());
            }
        }
        // Prefix strings so a quoted brace cannot be mistaken for syntax.
        tokens.push(format!("s{word}"));
    }
    /// Parse `tokens` starting at mutable cursor `i`; `depth` limits nesting and determines whether a closing brace is required. Advances the cursor or returns a syntax error.
    fn object(tokens: &[String], i: &mut usize, depth: usize) -> Result<Value, String> {
        if depth > 32 {
            return Err("Manifest ist zu tief verschachtelt".into());
        }
        let mut map = BTreeMap::new();
        while let Some(key) = tokens.get(*i) {
            if key == "}" {
                if depth == 0 {
                    return Err("Unerwartete Klammer".into());
                }
                *i += 1;
                return Ok(Value::Object(map));
            }
            let key = key
                .strip_prefix('s')
                .ok_or("Ungültiger Schlüssel")?
                .to_owned();
            *i += 1;
            let value = tokens.get(*i).ok_or("Wert fehlt")?;
            *i += 1;
            let value = if value == "{" {
                object(tokens, i, depth + 1)?
            } else {
                Value::Text(value.strip_prefix('s').ok_or("Ungültiger Wert")?.to_owned())
            };
            map.insert(key, value);
        }
        if depth != 0 {
            return Err("Schließende Klammer fehlt".into());
        }
        Ok(Value::Object(map))
    }
    object(&tokens, &mut 0, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_modern_steam_paths_comments_and_old_format() {
        let v = parse(
            r#"// Libraries
        "libraryfolders" { "0" { "path" "C:\\Steam" "apps" { "42" "1" } } "1" "D:\\Games" }"#,
        )
        .unwrap();
        let f = v.get("libraryfolders").unwrap();
        assert_eq!(
            f.get("0").unwrap().get("path").unwrap().text(),
            Some("C:\\Steam")
        );
        assert_eq!(f.get("1").unwrap().text(), Some("D:\\Games"));
    }
    #[test]
    fn rejects_truncated_and_deep_inputs() {
        assert!(parse("\"x\" { \"y\" \"z\"").is_err());
        assert!(parse("\"unterminated").is_err());
        assert!(parse(&format!("{}{}", "a {".repeat(40), "}".repeat(40))).is_err());
    }
    #[test]
    fn quoted_braces_are_values() {
        assert_eq!(
            parse("a \"}\"").unwrap().get("a").unwrap().text(),
            Some("}")
        );
    }
}
