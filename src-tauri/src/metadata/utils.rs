use crate::metadata::guidance::GuidanceClassifier;
use regex::Regex;
use std::sync::OnceLock;

static EMBEDDING_RE: OnceLock<Regex> = OnceLock::new();
static LORA_RE: OnceLock<Regex> = OnceLock::new();
static HYPERNET_RE: OnceLock<Regex> = OnceLock::new();

/// Extracts embeddings from prompt text across different tools.
///
/// Supported formats:
/// - ComfyUI/A1111: (embedding:name:1.2), embedding:name, <embedding:name>
/// - InvokeAI: <name>
pub fn extract_embeddings_from_prompt(text: &str) -> Vec<String> {
    let re = EMBEDDING_RE.get_or_init(|| {
        // Matches:
        // 1. embedding:name
        // 2. <embedding:name...>
        // 3. <name> (InvokeAI) - must have closing >
        Regex::new(r"(?i)(embedding:|<embedding:|<)([a-zA-Z0-9_\-\.]+)([:>])?")
            .expect("Regex compile failed")
    });

    let mut embeddings = Vec::new();
    for cap in re.captures_iter(text) {
        let prefix = cap
            .get(1)
            .map(|m| m.as_str().to_lowercase())
            .unwrap_or_default();
        let name = cap.get(2).map(|m| m.as_str()).unwrap_or_default();
        let closing = cap.get(3).map(|m| m.as_str()).unwrap_or_default();

        // Stricter check for bare <name> format
        if prefix == "<" {
            // Must have closing > and name must not be a prefix for other things
            if closing != ">" {
                continue;
            }
            let name_lower = name.to_lowercase();
            if name_lower == "lora"
                || name_lower == "hypernet"
                || name_lower.starts_with("lora:")
                || name_lower.starts_with("hypernet:")
            {
                continue;
            }
        }

        let name_str = name.to_string();

        // Skip common false positives or very short strings
        if name_str.len() < 2 {
            continue;
        }

        let cleaned = GuidanceClassifier::clean_name(&name_str);
        if !embeddings.contains(&cleaned) {
            embeddings.push(cleaned);
        }
    }
    embeddings
}

/// Extracts LoRAs from prompt text.
/// Format: <lora:name:weight>
pub fn extract_loras_from_prompt(text: &str) -> Vec<String> {
    let re = LORA_RE.get_or_init(|| {
        Regex::new(r"(?i)<lora:([^:>]+)(?::([0-9\.]+))?>").expect("Regex compile failed")
    });

    let mut loras = Vec::new();
    for cap in re.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().trim();
            let weight = cap.get(2).map(|w| w.as_str());

            let cleaned_name = GuidanceClassifier::clean_name(name);
            let entry = if let Some(w) = weight {
                if let Ok(wf) = w.parse::<f32>() {
                    if (wf - 1.0).abs() > 0.001 {
                        format!("{} ({:.2})", cleaned_name, wf)
                    } else {
                        cleaned_name
                    }
                } else {
                    cleaned_name
                }
            } else {
                cleaned_name
            };

            if !loras.contains(&entry) {
                loras.push(entry);
            }
        }
    }
    loras
}

/// Extracts Hypernetworks from prompt text.
/// Format: <hypernet:name:weight>
pub fn extract_hypernets_from_prompt(text: &str) -> Vec<String> {
    let re = HYPERNET_RE.get_or_init(|| {
        Regex::new(r"(?i)<hypernet:([^:>]+)(?::([0-9\.]+))?>").expect("Regex compile failed")
    });

    let mut hypernets = Vec::new();
    for cap in re.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().trim();
            let weight = cap.get(2).map(|w| w.as_str());

            let cleaned_name = GuidanceClassifier::clean_name(name);
            let entry = if let Some(w) = weight {
                if let Ok(wf) = w.parse::<f32>() {
                    if (wf - 1.0).abs() > 0.001 {
                        format!("{} ({:.2})", cleaned_name, wf)
                    } else {
                        cleaned_name
                    }
                } else {
                    cleaned_name
                }
            } else {
                cleaned_name
            };

            if !hypernets.contains(&entry) {
                hypernets.push(entry);
            }
        }
    }
    hypernets
}
