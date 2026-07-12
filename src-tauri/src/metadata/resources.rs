#[derive(Default)]
pub struct Resources {
    pub loras: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
    pub embeddings: Vec<String>,
}

const MAX_RESOURCE_SCAN_DEPTH: usize = 64;
const MAX_RESOURCE_SCAN_NODES: usize = 50_000;
const MAX_NESTED_JSON_STRING_DEPTH: usize = 4;
const MAX_NESTED_JSON_STRING_BYTES: usize = 2 * 1024 * 1024;
const MAX_AGGREGATE_NESTED_JSON_STRING_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
struct ResourceScanBudget {
    nodes_visited: usize,
    nested_json_string_bytes: usize,
    exhausted: bool,
    logged_limit: bool,
}

impl ResourceScanBudget {
    fn allow_node(&mut self, depth: usize) -> bool {
        if self.exhausted {
            return false;
        }
        if depth > MAX_RESOURCE_SCAN_DEPTH {
            self.exhaust("maximum traversal depth reached");
            return false;
        }
        if self.nodes_visited >= MAX_RESOURCE_SCAN_NODES {
            self.exhaust("maximum traversal node count reached");
            return false;
        }

        self.nodes_visited += 1;
        true
    }

    fn allow_nested_json_string(&mut self, nested_depth: usize, byte_len: usize) -> bool {
        if self.exhausted {
            return false;
        }
        if nested_depth >= MAX_NESTED_JSON_STRING_DEPTH {
            self.exhaust("maximum nested JSON string depth reached");
            return false;
        }
        if byte_len > MAX_NESTED_JSON_STRING_BYTES {
            self.note_limit("skipping oversized nested JSON string");
            return false;
        }
        if self.nested_json_string_bytes.saturating_add(byte_len)
            > MAX_AGGREGATE_NESTED_JSON_STRING_BYTES
        {
            self.exhaust("maximum aggregate nested JSON string bytes reached");
            return false;
        }

        self.nested_json_string_bytes += byte_len;
        true
    }

    fn exhaust(&mut self, reason: &str) {
        self.exhausted = true;
        self.note_limit(reason);
    }

    fn note_limit(&mut self, reason: &str) {
        if !self.logged_limit {
            log::debug!("[Resources] Resource metadata scan budget reached: {reason}");
            self.logged_limit = true;
        }
    }
}

pub fn extract_loras(val: &serde_json::Value, res: &mut Resources) {
    let process_item = |l: &serde_json::Value, res: &mut Resources| {
        let name = l
            .get("lora_name")
            .and_then(|v| v.as_str())
            .or_else(|| l.get("model_name").and_then(|v| v.as_str()))
            .or_else(|| {
                l.get("model").and_then(|m| {
                    m.as_str()
                        // v3.x: model.model_name
                        .or_else(|| m.get("model_name").and_then(|v| v.as_str()))
                        // v5.x: model.name
                        .or_else(|| m.get("name").and_then(|v| v.as_str()))
                })
            })
            .or_else(|| l.as_str()); // Handle string value direct

        if let Some(n) = name {
            // Default to 1.0 (standard implicit weight)
            let weight = l.get("weight").and_then(|w| w.as_f64()).unwrap_or(1.0);

            // Show everything EXCEPT 1.0 (including 0.0)
            let entry = if (weight - 1.0).abs() > f64::EPSILON {
                format!("{} ({:.2})", n, weight)
            } else {
                n.to_string()
            };

            if !res.loras.contains(&entry) {
                res.loras.push(entry);
            }
        }
    };

    if let Some(arr) = val.as_array() {
        for l in arr {
            process_item(l, res);
        }
    } else {
        process_item(val, res);
    }
}

pub fn extract_controlnets(val: &serde_json::Value, res: &mut Resources) {
    let process_item = |c: &serde_json::Value, res: &mut Resources| {
        let name = c
            .get("control_model")
            .and_then(|v| v.as_str())
            .or_else(|| c.get("model_name").and_then(|v| v.as_str()))
            .or_else(|| {
                c.get("model").and_then(|m| {
                    m.get("model_name")
                        .and_then(|v| v.as_str())
                        // v5.x: model.name
                        .or_else(|| m.get("name").and_then(|v| v.as_str()))
                })
            })
            .or_else(|| c.as_str()); // Handle string value direct

        if let Some(n) = name {
            let cleaned = crate::metadata::guidance::GuidanceClassifier::clean_name(n);

            // Redirection check
            let (category, _) = crate::metadata::guidance::GuidanceClassifier::classify(
                &cleaned, None,
            )
            .unwrap_or((
                crate::metadata::guidance::GuidanceCategory::ControlNet,
                "other".to_string(),
            ));

            match category {
                crate::metadata::guidance::GuidanceCategory::IPAdapter => {
                    if !res.ip_adapters.contains(&cleaned) {
                        res.ip_adapters.push(cleaned);
                    }
                }
                _ => {
                    if !res.control_nets.contains(&cleaned) {
                        res.control_nets.push(cleaned);
                    }
                }
            }
        }
    };

    if let Some(arr) = val.as_array() {
        for c in arr {
            process_item(c, res);
        }
    } else {
        process_item(val, res);
    }
}

pub fn extract_ipadapters(val: &serde_json::Value, res: &mut Resources) {
    let process_item = |item: &serde_json::Value, res: &mut Resources| {
        let name = item
            .get("ip_adapter_model")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("model_name").and_then(|v| v.as_str()))
            .or_else(|| {
                item.get("model").and_then(|m| {
                    m.get("model_name")
                        .and_then(|v| v.as_str())
                        .or_else(|| m.get("name").and_then(|v| v.as_str()))
                })
            })
            .or_else(|| item.as_str()); // Handle string value direct

        if let Some(n) = name {
            let cleaned = crate::metadata::guidance::GuidanceClassifier::clean_name(n);
            if !res.ip_adapters.contains(&cleaned) {
                res.ip_adapters.push(cleaned);
            }
        }
    };

    if let Some(arr) = val.as_array() {
        for item in arr {
            process_item(item, res);
        }
    } else {
        process_item(val, res);
    }
}

pub fn extract_embeddings(val: &serde_json::Value, res: &mut Resources) {
    let process_item = |item: &serde_json::Value, res: &mut Resources| {
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("model_name").and_then(|v| v.as_str()))
            .or_else(|| {
                item.get("model").and_then(|m| {
                    m.get("model_name")
                        .and_then(|v| v.as_str())
                        .or_else(|| m.get("name").and_then(|v| v.as_str()))
                })
            })
            .or_else(|| item.as_str());

        if let Some(n) = name {
            let cleaned = crate::metadata::guidance::GuidanceClassifier::clean_name(n);
            if !res.embeddings.contains(&cleaned) {
                res.embeddings.push(cleaned);
            }
        }
    };

    if let Some(arr) = val.as_array() {
        for item in arr {
            process_item(item, res);
        }
    } else {
        process_item(val, res);
    }
}

pub fn scan_for_resources(val: &serde_json::Value, res: &mut Resources) {
    let mut budget = ResourceScanBudget::default();
    scan_for_resources_inner(val, res, &mut budget, 0, 0);
}

fn scan_for_resources_inner(
    val: &serde_json::Value,
    res: &mut Resources,
    budget: &mut ResourceScanBudget,
    depth: usize,
    nested_json_string_depth: usize,
) {
    if !budget.allow_node(depth) {
        return;
    }

    match val {
        serde_json::Value::Object(map) => {
            if let Some(loras) = map.get("loras") {
                extract_loras(loras, res);
            }
            if let Some(cns) = map.get("controlnets") {
                extract_controlnets(cns, res);
            }
            if let Some(cns) = map.get("control_adapters") {
                extract_controlnets(cns, res);
            }
            if let Some(cns) = map.get("control_model") {
                extract_controlnets(cns, res);
            }
            if let Some(ips) = map.get("ip_adapters") {
                extract_ipadapters(ips, res);
            }
            if let Some(ips) = map.get("ip_adapter") {
                extract_ipadapters(ips, res);
            }
            if let Some(ips) = map.get("ip_adapter_model") {
                extract_ipadapters(ips, res);
            }
            if let Some(embs) = map.get("embeddings") {
                extract_embeddings(embs, res);
            }
            if let Some(embs) = map.get("ti") {
                extract_embeddings(embs, res);
            }
            if let Some(embs) = map.get("textual_inversion") {
                extract_embeddings(embs, res);
            }

            for (_, v) in map {
                if budget.exhausted {
                    break;
                }
                if let Some(s) = v.as_str() {
                    // Try to parse string as JSON if it looks like one
                    let trimmed = s.trim_start();
                    if trimmed.starts_with('{')
                        && budget.allow_nested_json_string(nested_json_string_depth, trimmed.len())
                    {
                        if let Ok(nested) = serde_json::from_str(s) {
                            scan_for_resources_inner(
                                &nested,
                                res,
                                budget,
                                depth + 1,
                                nested_json_string_depth + 1,
                            );
                        }
                    }
                } else if v.is_object() || v.is_array() {
                    scan_for_resources_inner(v, res, budget, depth + 1, nested_json_string_depth);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if budget.exhausted {
                    break;
                }
                scan_for_resources_inner(v, res, budget, depth + 1, nested_json_string_depth);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_loras_basic() {
        let mut res = Resources::default();
        let payload = json!([
            { "lora_name": "epiNoiseOffset", "weight": 1.0 },
            { "model_name": "detailer", "weight": 0.5 },
            { "lora_name": "zero_weight", "weight": 0.0 }
        ]);
        extract_loras(&payload, &mut res);
        assert_eq!(res.loras.len(), 3);
        assert!(res.loras.contains(&"epiNoiseOffset".to_string()));
        assert!(res.loras.contains(&"detailer (0.50)".to_string()));
        assert!(res.loras.contains(&"zero_weight (0.00)".to_string()));
    }

    #[test]
    fn test_extract_controlnets_basic() {
        let mut res = Resources::default();
        let payload = json!([
            { "control_model": "control_v11p_sd15_canny" },
            { "model_name": "control_v11f1p_sd15_depth" }
        ]);
        extract_controlnets(&payload, &mut res);
        assert_eq!(res.control_nets.len(), 2);
        assert!(res
            .control_nets
            .contains(&"control_v11p_sd15_canny".to_string()));
        assert!(res
            .control_nets
            .contains(&"control_v11f1p_sd15_depth".to_string()));
    }

    #[test]
    fn test_scan_for_resources_nested() {
        let mut res = Resources::default();
        let payload = json!({
            "metadata": {
                "loras": [
                    { "lora_name": "style1", "weight": 0.8 }
                ],
                "controlnets": [
                    { "control_model": "canny" }
                ]
            },
            "nodes": {
                "1": {
                    "loras": [
                        { "model_name": "style2", "weight": 1.0 }
                    ],
                    "control_model": "softedge"
                }
            }
        });
        scan_for_resources(&payload, &mut res);
        assert_eq!(res.loras.len(), 2);
        assert!(res.loras.contains(&"style1 (0.80)".to_string()));
        assert!(res.loras.contains(&"style2".to_string()));
        assert_eq!(res.control_nets.len(), 2);
        assert!(res.control_nets.contains(&"canny".to_string()));
        assert!(res.control_nets.contains(&"softedge".to_string()));
    }

    #[test]
    fn test_scan_for_resources_nested_json_string() {
        let mut res = Resources::default();
        let nested = json!({
            "loras": [
                { "lora_name": "string_style", "weight": 0.75 }
            ],
            "ip_adapters": [
                { "model_name": "face_adapter" }
            ]
        });
        let payload = json!({
            "workflow": serde_json::to_string(&nested).unwrap()
        });

        scan_for_resources(&payload, &mut res);

        assert_eq!(res.loras, vec!["string_style (0.75)".to_string()]);
        assert_eq!(res.ip_adapters, vec!["face_adapter".to_string()]);
    }

    #[test]
    fn test_scan_for_resources_stops_at_traversal_depth_budget() {
        let mut res = Resources::default();
        let mut deep = json!({ "loras": [{ "lora_name": "too_deep" }] });
        for _ in 0..(MAX_RESOURCE_SCAN_DEPTH + 2) {
            deep = json!({ "nested": deep });
        }
        let payload = json!({
            "loras": [{ "lora_name": "early" }],
            "deep": deep
        });

        scan_for_resources(&payload, &mut res);

        assert_eq!(res.loras, vec!["early".to_string()]);
    }

    #[test]
    fn test_scan_for_resources_stops_at_node_budget() {
        let mut res = Resources::default();
        let mut many_nodes: Vec<serde_json::Value> = (0..MAX_RESOURCE_SCAN_NODES)
            .map(|idx| json!({ "node": idx }))
            .collect();
        many_nodes.push(json!({
            "loras": [{ "lora_name": "too_late" }]
        }));
        let payload = json!({
            "loras": [{ "lora_name": "early" }],
            "many": many_nodes
        });

        scan_for_resources(&payload, &mut res);

        assert_eq!(res.loras, vec!["early".to_string()]);
        assert!(
            !res.loras.contains(&"too_late".to_string()),
            "resources past the node budget must not be extracted"
        );
    }

    #[test]
    fn test_scan_for_resources_stops_at_nested_json_string_depth_budget() {
        let mut res = Resources::default();
        let mut nested = json!({ "loras": [{ "lora_name": "too_deep" }] });
        for _ in 0..(MAX_NESTED_JSON_STRING_DEPTH + 1) {
            nested = json!({
                "wrapped": serde_json::to_string(&nested).unwrap()
            });
        }
        let payload = json!({
            "loras": [{ "lora_name": "early" }],
            "workflow": serde_json::to_string(&nested).unwrap()
        });

        scan_for_resources(&payload, &mut res);

        assert_eq!(res.loras, vec!["early".to_string()]);
    }

    #[test]
    fn test_scan_for_resources_skips_oversized_nested_json_string() {
        let mut res = Resources::default();
        let huge_name = "x".repeat(MAX_NESTED_JSON_STRING_BYTES);
        let oversized = format!("{{\"loras\":[{{\"lora_name\":\"{}\"}}]}}", huge_name);
        let valid = json!({
            "loras": [{ "lora_name": "small_valid" }]
        });
        let payload = json!({
            "oversized": oversized,
            "valid": serde_json::to_string(&valid).unwrap()
        });

        scan_for_resources(&payload, &mut res);

        assert_eq!(res.loras, vec!["small_valid".to_string()]);
    }

    #[test]
    fn test_scan_for_resources_stops_at_aggregate_nested_json_string_budget() {
        let mut res = Resources::default();
        let padding = "x".repeat(1024 * 1024);
        let mut payload = serde_json::Map::new();
        for idx in 0..10 {
            let nested = json!({
                "loras": [{ "lora_name": format!("style_{idx}") }],
                "padding": padding
            });
            payload.insert(
                format!("workflow_{idx}"),
                serde_json::Value::String(serde_json::to_string(&nested).unwrap()),
            );
        }

        scan_for_resources(&serde_json::Value::Object(payload), &mut res);

        assert!(
            !res.loras.is_empty(),
            "resources found before the aggregate budget is exhausted should be preserved"
        );
        assert!(
            res.loras.len() < 10,
            "aggregate nested JSON string budget should prevent parsing every payload"
        );
    }

    #[test]
    fn test_scan_for_resources_deduplication() {
        let mut res = Resources::default();
        let payload = json!({
            "loras": [
                { "lora_name": "style1", "weight": 1.0 }
            ],
            "nested": {
                "loras": [
                    { "lora_name": "style1", "weight": 1.0 }
                ]
            }
        });
        scan_for_resources(&payload, &mut res);
        assert_eq!(res.loras.len(), 1);
    }
}
