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

    // Extract embedded workflow/graph if present
    if let Some(wf) = root.get("workflow").or_else(|| root.get("graph")) {
        meta.workflow_json = Some(if wf.is_string() {
            wf.as_str().unwrap().to_string()
        } else {
            wf.to_string()
        });
    }

    meta
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_invokeai_metadata_legacy() {
        let payload = json!({
            "prompt": [
                { "prompt": "a professional portrait" },
                { "prompt": "extreme detail" }
            ],
            "steps": 30,
            "cfg_scale": 7.5,
            "seed": 42,
            "scheduler": "k_euler_a"
        });
        let meta = extract_invokeai_metadata(&payload);
        assert_eq!(meta.tool, "InvokeAI");
        assert_eq!(meta.positive_prompt, "a professional portrait extreme detail");
        assert_eq!(meta.steps, 30);
        assert_eq!(meta.cfg, 7.5);
        assert_eq!(meta.seed, 42);
        assert_eq!(meta.sampler, "k_euler_a");
    }

    #[test]
    fn test_extract_invokeai_metadata_graph() {
        let payload = json!({
            "positive_prompt": "modern house in the hills",
            "negative_prompt": "low quality, blurry",
            "steps": 25,
            "cfg": 8.0,
            "seed": 123456,
            "sampler_name": "dpmpp_2m",
            "model": {
                "model_name": "stable-diffusion-xl-base-1.0"
            }
        });
        let meta = extract_invokeai_metadata(&payload);
        assert_eq!(meta.positive_prompt, "modern house in the hills");
        assert_eq!(meta.negative_prompt, "low quality, blurry");
        assert_eq!(meta.cfg, 8.0);
        assert_eq!(meta.sampler, "dpmpp_2m");
        assert_eq!(meta.model, "stable-diffusion-xl-base-1.0");
    }

    #[test]
    fn test_extract_invokeai_metadata_conditioning() {
        let payload = json!({
            "positive_conditioning": "mountain landscape",
            "negative_conditioning": "clouds",
            "is_intermediate": true
        });
        let meta = extract_invokeai_metadata(&payload);
        assert_eq!(meta.positive_prompt, "mountain landscape");
        assert_eq!(meta.negative_prompt, "clouds");
        assert!(meta.is_intermediate);
    }
}
