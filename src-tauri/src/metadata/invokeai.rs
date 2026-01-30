use super::resources::{scan_for_resources, Resources};
use super::utils::{extract_embeddings_from_prompt, extract_hypernets_from_prompt, extract_loras_from_prompt};
use super::ImageMetadata;

pub fn extract_invokeai_metadata(json: &serde_json::Value) -> ImageMetadata {
    let mut meta = ImageMetadata::default();
    meta.tool = "InvokeAI".to_string();

    // Handle root vs image wrapped (v2.x has metadata in "image" object)
    let root = json.get("image").unwrap_or(json);

    // ===== V2.x Format Support =====
    // model_weights is at the TOP level in v2.x, not inside "image"
    if let Some(weights) = json.get("model_weights").and_then(|s| s.as_str()) {
        meta.model = weights.to_string();
    }
    // model_hash at top level
    if let Some(hash) = json.get("model_hash").and_then(|s| s.as_str()) {
        meta.model_hash = Some(hash.to_string());
    }

    // Check optional is_intermediate flag
    if let Some(val) = root.get("is_intermediate") {
        if val.as_bool() == Some(true) {
            meta.is_intermediate = true;
        }
    }

    // Prompt extraction - v2.x uses array format inside root.prompt
    if let Some(prompt) = root.get("prompt") {
        if let Some(arr) = prompt.as_array() {
            // Old v2.x format: [{"prompt": "...", "weight": 1.0}, ...]
            let mut prompt_parts = Vec::new();
            for p in arr {
                if let Some(pt) = p.get("prompt").and_then(|s| s.as_str()) {
                    prompt_parts.push(pt);
                }
            }
            if !prompt_parts.is_empty() {
                meta.positive_prompt = prompt_parts.join(" ");
            }
        }
    }

    // Try new InvokeAI Graph format / Metadata (v3.x)
    if meta.positive_prompt.is_empty() {
        if let Some(pos) = root.get("positive_prompt").and_then(|s| s.as_str()) {
            meta.positive_prompt = pos.trim().to_string();
        } else if let Some(pos) = root.get("positive_conditioning").and_then(|s| s.as_str()) {
            meta.positive_prompt = pos.trim().to_string();
        }
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
    } else if let Some(seed) = root.get("seed").and_then(|v| v.as_u64()) {
        // Handle unsigned seed values (common in v2.x)
        meta.seed = seed as i64;
    }

    // Sampler - v2.x uses "sampler", v3.x uses "scheduler" or "sampler_name"
    if let Some(sampler) = root.get("sampler").and_then(|s| s.as_str()) {
        meta.sampler = sampler.to_string();
    } else if let Some(sampler) = root.get("scheduler").and_then(|s| s.as_str()) {
        meta.sampler = sampler.to_string();
    } else if let Some(sampler) = root.get("sampler_name").and_then(|s| s.as_str()) {
        meta.sampler = sampler.to_string();
    }

    // Model - v5.x uses model.name, v3.x uses model.model_name, v2.x uses model_weights at root
    if meta.model.is_empty() || meta.model == "Unknown" {
        if let Some(model) = root.get("model") {
            // Try v3.x format: model.model_name
            if let Some(name) = model.get("model_name").and_then(|s| s.as_str()) {
                meta.model = name.to_string();
            }
            // Try v5.x format: model.name
            else if let Some(name) = model.get("name").and_then(|s| s.as_str()) {
                meta.model = name.to_string();
            }
            // Fallback: model as string
            else if let Some(name) = model.as_str() {
                meta.model = name.to_string();
            }

            // Extract model hash from v5.x format (model.hash with blake3: prefix)
            if meta.model_hash.is_none() {
                if let Some(hash) = model.get("hash").and_then(|s| s.as_str()) {
                    // Strip blake3: or similar prefix if present
                    let clean_hash = hash.split(':').last().unwrap_or(hash);
                    meta.model_hash = Some(clean_hash.to_string());
                }
            }
        }
    }

    // Generation type - v2.x uses "type", v3.x uses "generation_mode"
    if let Some(gen_type) = root.get("generation_mode").and_then(|s| s.as_str()) {
        meta.generation_type = gen_type.to_string();
    } else if let Some(gen_type) = root.get("type").and_then(|s| s.as_str()) {
        meta.generation_type = gen_type.to_string();
    }

    // Clip Skip (v3.x)
    if let Some(clip) = root.get("clip_skip").and_then(|v| v.as_u64()) {
        if clip > 0 {
            meta.clip_skip = Some(clip as u32);
        }
    }

    // Hires Fix (v3.x uses hrf_*)
    if let Some(enabled) = root.get("hrf_enabled").and_then(|v| v.as_bool()) {
        if enabled {
            if let Some(strength) = root.get("hrf_strength").and_then(|v| v.as_f64()) {
                meta.denoising_strength = Some(strength as f32);
            }
            if let Some(method) = root.get("hrf_method").and_then(|s| s.as_str()) {
                meta.hires_upscaler = Some(method.to_string());
            }
        }
    }

    // Resources (LoRAs, ControlNets, IP-Adapters)
    let mut resources = Resources::default();
    scan_for_resources(json, &mut resources);

    meta.loras = resources.loras;
    meta.control_nets = resources.control_nets;
    meta.ip_adapters = resources.ip_adapters;
    meta.embeddings = resources.embeddings;

    // --- Extract Embeddings from Prompts (Post-scan to avoid overwrites) ---
    for emb in extract_embeddings_from_prompt(&meta.positive_prompt) {
        if !meta.embeddings.contains(&emb) {
            meta.embeddings.push(emb);
        }
    }
    for emb in extract_embeddings_from_prompt(&meta.negative_prompt) {
        if !meta.embeddings.contains(&emb) {
            meta.embeddings.push(emb);
        }
    }

    // --- Extract LoRAs from Prompts ---
    for lora in extract_loras_from_prompt(&meta.positive_prompt) {
        if !meta.loras.contains(&lora) {
            meta.loras.push(lora);
        }
    }
    for lora in extract_loras_from_prompt(&meta.negative_prompt) {
        if !meta.loras.contains(&lora) {
            meta.loras.push(lora);
        }
    }

    // --- Extract Hypernetworks from Prompts ---
    for hn in extract_hypernets_from_prompt(&meta.positive_prompt) {
        if !meta.hypernetworks.contains(&hn) {
            meta.hypernetworks.push(hn);
        }
    }
    for hn in extract_hypernets_from_prompt(&meta.negative_prompt) {
        if !meta.hypernetworks.contains(&hn) {
            meta.hypernetworks.push(hn);
        }
    }

    // Extract embedded workflow/graph if present
    if let Some(wf) = root.get("workflow").or_else(|| root.get("graph")) {
        meta.workflow_json = Some(if wf.is_string() {
            wf.as_str().unwrap().to_string()
        } else {
            wf.to_string()
        });
    }

    // Detect postprocessing-only images (upscales, face fixes, etc.)
    // These have postprocessing data but no generation data (no prompt, no steps, no model)
    // Note: generation_type defaults to "unknown", so check for both empty and unknown
    if (meta.generation_type.is_empty() || meta.generation_type == "unknown")
        && meta.positive_prompt.is_empty()
        && meta.steps == 0
    {
        if let Some(pp) = root.get("postprocessing") {
            if pp.is_array() && !pp.as_array().unwrap().is_empty() {
                meta.generation_type = "postprocess".to_string();
            }
        }
    }

    // Check for favorite/starred status
    // User report: "subject:favorite" key value pair in older InvokeAI images
    if let Some(subject) = root.get("subject").and_then(|s| s.as_str()) {
        if subject == "favorite" {
            meta.is_favorite = true;
        }
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
        assert_eq!(
            meta.positive_prompt,
            "a professional portrait extreme detail"
        );
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

    #[test]
    fn test_extract_invokeai_v2x_archived_format() {
        // Real v2.x format from InvokeAI 2.2.5 archived images
        let payload = json!({
            "model": "stable diffusion",
            "model_weights": "Cyberpunk-Anime-Diffusion",
            "model_hash": "a8f7dcece7bc4a6273ed1efa427d481b03237a8f635f1bc44128dd48217a2947",
            "app_id": "invoke-ai/InvokeAI",
            "app_version": "2.2.5",
            "image": {
                "prompt": [
                    {"prompt": "human flower by Android Jones", "weight": 1.0}
                ],
                "steps": 50,
                "cfg_scale": 7.5,
                "seed": 3038946690_u64,
                "sampler": "k_lms",
                "type": "txt2img",
                "width": 512,
                "height": 768
            }
        });
        let meta = extract_invokeai_metadata(&payload);

        assert_eq!(meta.tool, "InvokeAI");
        assert_eq!(meta.model, "Cyberpunk-Anime-Diffusion");
        assert_eq!(
            meta.model_hash.as_deref(),
            Some("a8f7dcece7bc4a6273ed1efa427d481b03237a8f635f1bc44128dd48217a2947")
        );
        assert_eq!(meta.steps, 50);
        assert_eq!(meta.cfg, 7.5);
        assert_eq!(meta.seed, 3038946690);
        assert_eq!(meta.sampler, "k_lms");
        assert_eq!(meta.generation_type, "txt2img");
        assert!(meta.positive_prompt.contains("human flower"));
    }

    #[test]
    fn test_extract_invokeai_v3x_format() {
        // Real v3.x format with generation_mode, model object, clip_skip, hrf_*
        let payload = json!({
            "generation_mode": "txt2img",
            "positive_prompt": "A young couple enjoying kendo",
            "negative_prompt": "(worst quality, low quality)",
            "width": 1024,
            "height": 1536,
            "seed": 624077823,
            "cfg_scale": 7.0,
            "steps": 24,
            "scheduler": "dpmpp_2m_k",
            "clip_skip": 2,
            "model": {
                "model_name": "westernAnimation_v1",
                "base_model": "sd-1",
                "model_type": "main"
            },
            "hrf_enabled": true,
            "hrf_method": "bilinear",
            "hrf_strength": 0.6
        });
        let meta = extract_invokeai_metadata(&payload);

        assert_eq!(meta.tool, "InvokeAI");
        assert_eq!(meta.model, "westernAnimation_v1");
        assert_eq!(meta.steps, 24);
        assert_eq!(meta.cfg, 7.0);
        assert_eq!(meta.seed, 624077823);
        assert_eq!(meta.sampler, "dpmpp_2m_k");
        assert_eq!(meta.generation_type, "txt2img");
        assert_eq!(meta.clip_skip, Some(2));
        assert_eq!(meta.denoising_strength, Some(0.6));
        assert_eq!(meta.hires_upscaler.as_deref(), Some("bilinear"));
        assert!(meta.positive_prompt.contains("kendo"));
        assert!(meta.negative_prompt.contains("worst quality"));
    }

    #[test]
    fn test_extract_invokeai_postprocessing_only() {
        // Real postprocessing-only metadata (upscaled image with no generation data)
        let payload = json!({
            "image": {
                "postprocessing": [
                    {
                        "orig_path": ["C:\\path\\to\\original.png"],
                        "orig_hash": "7b50037210f6fb694db857cff31c15d98bdb35983a7bc25c259224a74d2d440e",
                        "type": "esrgan",
                        "scale": 4,
                        "strength": 0.75
                    },
                    {
                        "type": "gfpgan",
                        "strength": 0.8
                    }
                ]
            }
        });
        let meta = extract_invokeai_metadata(&payload);

        assert_eq!(meta.tool, "InvokeAI");
        assert_eq!(meta.generation_type, "postprocess");
        assert!(meta.positive_prompt.is_empty());
        assert_eq!(meta.steps, 0);
        assert!(meta.model.is_empty() || meta.model == "Unknown");
    }

    #[test]
    fn test_extract_invokeai_favorite() {
        // Test "subject": "favorite"
        let payload = json!({
            "prompt": [
                { "prompt": "test" }
            ],
            "subject": "favorite"
        });
        let meta = extract_invokeai_metadata(&payload);
        assert!(meta.is_favorite);
    }

    #[test]
    fn test_extract_invokeai_prompt_embeddings() {
        let payload = json!({
            "positive_prompt": "a beautiful forest, <easynegative>, <style1>, <<<<full body shot, <lora:methurlant:1>",
            "negative_prompt": "<bad_quality>, ugly, <hypernet:A1 Extra:0.15>",
            "steps": 20
        });
        let meta = extract_invokeai_metadata(&payload);
        assert_eq!(meta.embeddings.len(), 3);
        assert!(meta.embeddings.contains(&"easynegative".to_string()));
        assert!(meta.embeddings.contains(&"style1".to_string()));
        assert!(meta.embeddings.contains(&"bad_quality".to_string()));
        assert!(!meta.embeddings.contains(&"full".to_string()));
    }

    #[test]
    fn test_extract_invokeai_prompt_loras() {
        let payload = json!({
            "positive_prompt": "a cat, <lora:style_v1:0.8>, <lora:detailer:1.0>",
            "negative_prompt": "low quality"
        });
        let meta = extract_invokeai_metadata(&payload);
        assert_eq!(meta.loras.len(), 2);
        assert!(meta.loras.contains(&"style_v1 (0.80)".to_string()));
        assert!(meta.loras.contains(&"detailer".to_string()));
    }

    #[test]
    fn test_extract_invokeai_prompt_hypernetworks() {
        let payload = json!({
            "positive_prompt": "a cat, <hypernet:style_v1:0.8>, <hypernet:detailer:1.0>",
            "negative_prompt": "<hypernet:A1 Extra-600000:0.15>"
        });
        let meta = extract_invokeai_metadata(&payload);
        assert_eq!(meta.hypernetworks.len(), 3);
        assert!(meta.hypernetworks.contains(&"style_v1 (0.80)".to_string()));
        assert!(meta.hypernetworks.contains(&"detailer".to_string()));
        assert!(meta.hypernetworks.contains(&"A1 Extra-600000 (0.15)".to_string()));
    }
}
