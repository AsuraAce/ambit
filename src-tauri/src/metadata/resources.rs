#[derive(Default)]
pub struct Resources {
    pub loras: Vec<String>,
    pub control_nets: Vec<String>,
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
                            .or_else(|| m.get("model_name").and_then(|v| v.as_str()))
                    })
                });

            if let Some(n) = name {
                let weight = l.get("weight").and_then(|w| w.as_f64()).unwrap_or(0.0);
                let entry = if weight != 0.0 && weight != 1.0 {
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
                    c.get("model")
                        .and_then(|m| m.get("model_name").and_then(|v| v.as_str()))
                });

            if let Some(n) = name {
                if !res.control_nets.contains(&n.to_string()) {
                    res.control_nets.push(n.to_string());
                }
            }
        }
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
