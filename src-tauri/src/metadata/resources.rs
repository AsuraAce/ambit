#[derive(Default)]
pub struct Resources {
    pub loras: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
}

pub fn extract_loras(val: &serde_json::Value, res: &mut Resources) {
    if let Some(arr) = val.as_array() {
        for l in arr {
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
                });

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
        }
    }
}

pub fn extract_controlnets(val: &serde_json::Value, res: &mut Resources) {
    if let Some(arr) = val.as_array() {
        for c in arr {
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
                });

            if let Some(n) = name {
                if !res.control_nets.contains(&n.to_string()) {
                    res.control_nets.push(n.to_string());
                }
            }
        }
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
            });

        if let Some(n) = name {
            if !res.ip_adapters.contains(&n.to_string()) {
                res.ip_adapters.push(n.to_string());
            }
        }
    };

    if let Some(arr) = val.as_array() {
        for item in arr {
            process_item(item, res);
        }
    } else if val.is_object() {
        process_item(val, res);
    }
}

pub fn scan_for_resources(val: &serde_json::Value, res: &mut Resources) {
    match val {
        serde_json::Value::Object(map) => {
            if let Some(loras) = map.get("loras") {
                extract_loras(loras, res);
            }
            if let Some(cns) = map.get("controlnets").or(map.get("control_adapters")) {
                extract_controlnets(cns, res);
            }
            if let Some(ips) = map.get("ip_adapters").or(map.get("ip_adapter")) {
                extract_ipadapters(ips, res);
            }

            for (_, v) in map {
                if let Some(s) = v.as_str() {
                    if s.trim_start().starts_with('{') {
                        if let Ok(nested) = serde_json::from_str(s) {
                            scan_for_resources(&nested, res);
                        }
                    }
                } else {
                    scan_for_resources(v, res);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                scan_for_resources(v, res);
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
                    ]
                }
            }
        });
        scan_for_resources(&payload, &mut res);
        assert_eq!(res.loras.len(), 2);
        assert!(res.loras.contains(&"style1 (0.80)".to_string()));
        assert!(res.loras.contains(&"style2".to_string()));
        assert_eq!(res.control_nets.len(), 1);
        assert!(res.control_nets.contains(&"canny".to_string()));
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
