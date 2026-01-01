use regex::Regex;
use super::ImageMetadata;

pub fn extract_a1111_metadata(text: &str) -> ImageMetadata {
    let sanitized_text = text.replace('\0', "");
    let mut meta = ImageMetadata::default();
    meta.tool = "Automatic1111".to_string();
    meta.raw_parameters = Some(sanitized_text.clone());

    let lines: Vec<&str> = sanitized_text.lines().map(|l| l.trim()).collect();
    if lines.is_empty() {
        return meta;
    }

    let mut positive_parts = Vec::new();
    let mut negative_prompt = String::new();
    let mut params_lines = Vec::new();
    let mut state = 0; // 0: positive, 1: negative, 2: params

    for line in lines {
        if line.starts_with("Negative prompt: ") {
            state = 1;
            negative_prompt.push_str(&line[17..]);
        } else if line.starts_with("Steps: ") {
            state = 2;
            params_lines.push(line.to_string());
        } else if state == 0 {
            positive_parts.push(line);
        } else if state == 1 {
            if !negative_prompt.is_empty() {
                negative_prompt.push(' ');
            }
            negative_prompt.push_str(line);
        } else if state == 2 {
            params_lines.push(line.to_string());
        }
    }

    meta.positive_prompt = positive_parts.join("\n").trim().to_string();
    meta.negative_prompt = negative_prompt.trim().to_string();

    // Parse params (prefer the line starting with Steps:)
    let params_line = params_lines.iter().find(|l| l.starts_with("Steps: ")).cloned().unwrap_or_default();

    if params_line.starts_with("Steps: ") {
        let pairs = params_line.split(", ");
        let mut variation_seed = String::new();
        let mut variation_strength = String::new();

        for pair in pairs {
            if let Some((key, val)) = pair.split_once(": ") {
                let key = key.trim();
                let val = val.trim();
                match key {
                    "Steps" => meta.steps = val.parse().unwrap_or(0),
                    "Sampler" => meta.sampler = val.to_string(),
                    "CFG scale" => meta.cfg = val.parse().unwrap_or(0.0),
                    "Seed" => meta.seed = val.parse().unwrap_or(0),
                    "Model" | "Checkpoint" | "Model name" | "SD model" => meta.model = val.to_string(),
                    "VAE" => meta.vae = Some(val.to_string()),
                    "Clip skip" => meta.clip_skip = val.parse().ok(),
                    "Denoising strength" => meta.denoising_strength = val.parse().ok(),
                    "Hires upscale" => meta.hires_upscale = val.parse().ok(),
                    "Hires steps" => meta.hires_steps = val.parse().ok(),
                    "Hires upscaler" => meta.hires_upscaler = Some(val.to_string()),
                    "Model hash" => meta.model_hash = Some(val.to_string()),
                    "App" => {
                        let low_val = val.to_lowercase();
                        if low_val.contains("sd.next") || low_val.contains("sdnext") {
                            meta.tool = "SD.Next".to_string();
                        } else if low_val.contains("forge") {
                            meta.tool = "Forge".to_string();
                        }
                    }
                    "Version" => {
                        let low_val = val.to_lowercase();
                        if meta.tool == "Automatic1111" {
                             if low_val.contains("vlad") || low_val.contains("next") || low_val.contains("sd.next") {
                                 meta.tool = "SD.Next".to_string();
                             } else if low_val.contains("forge") || low_val.starts_with('f') {
                                 meta.tool = "Forge".to_string();
                             } else if low_val.contains("comfy") {
                                 meta.tool = "ComfyUI".to_string();
                             }
                        }
                    },
                    "sd_model_hash" => {
                        if meta.model_hash.is_none() {
                            meta.model_hash = Some(val.to_string());
                        }
                    }
                    "Variation seed" => variation_seed = val.to_string(),
                    "Variation seed strength" => variation_strength = val.to_string(),
                    _ => {
                        // Special handling for ControlNet
                        if key.starts_with("ControlNet") {
                            if let Some(start) = val.find("Model: ") {
                                let model_part = &val[start + 7..];
                                let model_name = model_part.split(',').next().unwrap_or("").trim();
                                if !model_name.is_empty() {
                                    meta.control_nets.push(model_name.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        if !variation_seed.is_empty() && !variation_strength.is_empty() {
            meta.variation_id = Some(format!("{}:{}", variation_seed, variation_strength));
        }
    }

    // Extract LoRAs from positive prompt
    if let Ok(re) = Regex::new(r"<lora:([^:>]+)(?::[^>]+)?>") {
        for cap in re.captures_iter(&meta.positive_prompt) {
            let lora_name = cap[1].to_string();
            if !meta.loras.contains(&lora_name) {
                meta.loras.push(lora_name);
            }
        }
    }

    meta
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_a1111_metadata_basic() {
        let raw = "Positive prompt here\nNegative prompt: Negative content\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Model: v1-5-pruned, Model hash: abcde";
        let meta = extract_a1111_metadata(raw);
        
        assert_eq!(meta.tool, "Automatic1111");
        assert_eq!(meta.positive_prompt, "Positive prompt here");
        assert_eq!(meta.negative_prompt, "Negative content");
        assert_eq!(meta.steps, 20);
        assert_eq!(meta.cfg, 7.0);
        assert_eq!(meta.seed, 12345);
        assert_eq!(meta.model, "v1-5-pruned");
        assert_eq!(meta.model_hash.as_deref(), Some("abcde"));
    }

    #[test]
    fn test_extract_a1111_sdnext_detection() {
        let raw_app = "Prompt\nSteps: 20, App: SD.Next, Version: 1.0";
        let meta_app = extract_a1111_metadata(raw_app);
        assert_eq!(meta_app.tool, "SD.Next");

        let raw_vlad = "Prompt\nSteps: 20, Version: Vlad Mandic";
        let meta_vlad = extract_a1111_metadata(raw_vlad);
        assert_eq!(meta_vlad.tool, "SD.Next");

        let raw_forge = "Prompt\nSteps: 20, Version: forge";
        let meta_forge = extract_a1111_metadata(raw_forge);
        assert_eq!(meta_forge.tool, "Forge");

        let raw_forge_v2 = "Prompt\nSteps: 20, Version: f2.0.1v1.10.1-previous-224-g90019688";
        let meta_forge_v2 = extract_a1111_metadata(raw_forge_v2);
        assert_eq!(meta_forge_v2.tool, "Forge");
    }
    
    #[test]
    fn test_extract_loras() {
        let raw = "A beautiful <lora:cool_style:0.8> painting <lora:other_one:1>";
        let meta = extract_a1111_metadata(raw);
        assert!(meta.loras.contains(&"cool_style".to_string()));
        assert!(meta.loras.contains(&"other_one".to_string()));
    }
}
