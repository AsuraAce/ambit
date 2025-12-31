use super::ImageMetadata;
use super::resources::{Resources, scan_for_resources};

pub fn extract_invokeai_metadata(json: &serde_json::Value) -> ImageMetadata {
    let mut meta = ImageMetadata::default();
    meta.tool = "InvokeAI".to_string();

    // Handle root vs image wrapped
    let root = json.get("image").unwrap_or(json);

    // Check optional is_intermediate flag
    if let Some(val) = root.get("is_intermediate") {
        if val.as_bool() == Some(true) {
            meta.is_intermediate = true;
        }
    }

    if let Some(prompt) = root.get("prompt") {
        if let Some(arr) = prompt.as_array() {
            // Old format
            let mut prompt_parts = Vec::new();
            for p in arr {
                if let Some(pt) = p.get("prompt").and_then(|s| s.as_str()) {
                    prompt_parts.push(pt);
                }
            }
            meta.positive_prompt = prompt_parts.join(" ");
        }
    }

    // Try new InvokeAI Graph format / Metadata
    if let Some(pos) = root.get("positive_prompt").and_then(|s| s.as_str()) {
        meta.positive_prompt = pos.trim().to_string();
    } else if let Some(pos) = root.get("positive_conditioning").and_then(|s| s.as_str()) {
        meta.positive_prompt = pos.trim().to_string();
    }

    if let Some(neg) = root.get("negative_prompt").and_then(|s| s.as_str()) {
        meta.negative_prompt = neg.trim().to_string();
    } else if let Some(neg) = root.get("negative_conditioning").and_then(|s| s.as_str()) {
        meta.negative_prompt = neg.trim().to_string();
    }

    if let Some(steps) = root.get("steps").and_then(|v| v.as_u64()) {
        meta.steps = steps as u32;
    }
    if let Some(cfg) = root.get("cfg_scale").and_then(|v| v.as_f64()) {
        meta.cfg = cfg as f32;
    } else if let Some(cfg) = root.get("cfg").and_then(|v| v.as_f64()) {
        meta.cfg = cfg as f32;
    }

    if let Some(seed) = root.get("seed").and_then(|v| v.as_i64()) {
        meta.seed = seed;
    }

    if let Some(sampler) = root.get("scheduler").and_then(|s| s.as_str()) {
        meta.sampler = sampler.to_string();
    } else if let Some(sampler) = root.get("sampler_name").and_then(|s| s.as_str()) {
        meta.sampler = sampler.to_string();
    }

    if let Some(model) = root.get("model") {
        if let Some(name) = model.get("model_name").and_then(|s| s.as_str()) {
             meta.model = name.to_string();
        } else if let Some(name) = model.as_str() {
             meta.model = name.to_string();
        }
    }

    // Resources (LoRAs, ControlNets)
    let mut resources = Resources::default();
    scan_for_resources(json, &mut resources);
    
    meta.loras = resources.loras;
    meta.control_nets = resources.control_nets;

    meta
}
