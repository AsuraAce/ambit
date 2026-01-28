use super::ImageMetadata;
use regex::Regex;

fn split_a1111_params(s: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut depth = 0;
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            in_quotes = !in_quotes;
            current.push(c);
        } else if (c == '(' || c == '[' || c == '{') && !in_quotes {
            depth += 1;
            current.push(c);
        } else if (c == ')' || c == ']' || c == '}') && !in_quotes {
            if depth > 0 {
                depth -= 1;
            }
            current.push(c);
        } else if c == ',' && !in_quotes && depth == 0 {
            result.push(current.trim().to_string());
            current = String::new();
            // Skip the potential space after comma
            if i + 1 < chars.len() && chars[i + 1] == ' ' {
                i += 1;
            }
        } else {
            current.push(c);
        }
        i += 1;
    }
    if !current.trim().is_empty() {
        result.push(current.trim().to_string());
    }
    result
}

pub fn extract_a1111_metadata(text: &str, default_tool: Option<String>) -> ImageMetadata {
    let sanitized_text = text.replace('\0', "");
    let mut meta = ImageMetadata::default();
    meta.tool = default_tool.unwrap_or_else(|| "Automatic1111".to_string());
    meta.raw_parameters = Some(sanitized_text.clone());

    let mut normalized_lines = Vec::new();
    for line in sanitized_text.lines() {
        let mut l = line.to_string();
        // Break jumbled one-liners into logical segments
        if l.contains("Negative prompt: ") {
            l = l.replace("Negative prompt: ", "\nNegative prompt: ");
        }
        if l.contains("Steps: ") {
            l = l.replace("Steps: ", "\nSteps: ");
        }
        for subline in l.lines() {
            let s = subline.trim();
            if !s.is_empty() {
                normalized_lines.push(s.to_string());
            }
        }
    }

    let mut positive_parts = Vec::new();
    let mut negative_prompt = String::new();
    let mut params_lines = Vec::new();
    let mut state = 0; // 0: positive, 1: negative, 2: params

    for line in normalized_lines {
        if line.starts_with("Negative prompt: ") {
            state = 1;
            let content = line[17..].trim();
            if content.starts_with("Model: ") || content.starts_with("Seed: ") || content.starts_with("Steps: ") {
                state = 2;
                if !content.is_empty() {
                    params_lines.push(content.to_string());
                }
            } else {
                negative_prompt.push_str(content);
            }
        } else if line.starts_with("Steps: ") {
            state = 2;
            params_lines.push(line);
        } else if state == 0 {
            // Check for ComfyUI "SDPromptSaver" style params starting at the top
            if line.starts_with("Model: ") || line.starts_with("Seed: ") {
                state = 2;
                params_lines.push(line);
            } else {
                positive_parts.push(line);
            }
        } else if state == 1 {
            // Check if even inside negative prompt we hit more params (ComfyUI mess)
            if line.starts_with("Model: ") || line.starts_with("Seed: ") {
                state = 2;
                params_lines.push(line);
            } else {
                if !negative_prompt.is_empty() {
                    negative_prompt.push(' ');
                }
                negative_prompt.push_str(&line);
            }
        } else if state == 2 {
            params_lines.push(line);
        }
    }

    meta.positive_prompt = positive_parts.join("\n").trim().to_string();
    meta.negative_prompt = negative_prompt.trim().to_string();

    // Parse params (process all lines identified as params)
    for line in params_lines {
        let mut params_content = line.clone();

        // Fallback: If line contains prompts and then "Steps: ", isolate params
        if let Some(pos) = params_content.find("Steps: ") {
            // But only if Steps: is not at the start and preceded by something that looks like prompt
            if pos > 0 && !params_content[..pos].contains(": ") {
                params_content = params_content[pos..].to_string();
            }
        }

        let pairs = split_a1111_params(&params_content);
        let mut variation_seed = String::new();
        let mut variation_strength = String::new();

        for pair in pairs {
            if let Some((key, val)) = pair.split_once(": ") {
                let key = key.trim();
                let val = val.trim().trim_matches('"');
                match key {
                    "Steps" => {
                        let s: u32 = val.parse().unwrap_or(0);
                        if s > 0 {
                            meta.steps = s;
                        }
                    }
                    "Sampler" => {
                        let cleaned_val = if val == "_" || val == "None" || val.is_empty() {
                            "Unknown"
                        } else {
                            val
                        };

                        if meta.sampler == "Unknown" || meta.sampler.is_empty() {
                            meta.sampler = cleaned_val.to_string();
                        } else if cleaned_val != "Unknown" && !meta.sampler.contains(cleaned_val) {
                            meta.sampler = format!("{}_{}", meta.sampler, cleaned_val);
                        }
                    }
                    "Scheduler" => {
                        if meta.sampler.is_empty() || meta.sampler == "Unknown" {
                            meta.sampler = format!("Unknown ({})", val);
                        } else if !meta.sampler.to_lowercase().contains(&val.to_lowercase()) {
                            meta.sampler = format!("{}_{}", meta.sampler, val);
                        }
                    }
                    "CFG scale" => {
                        let c: f32 = val.parse().unwrap_or(0.0);
                        if c > 0.0 {
                            meta.cfg = c;
                        }
                    }
                    "Seed" => {
                        let s: i64 = val.parse().unwrap_or(0);
                        if s > 0 {
                            meta.seed = s;
                        }
                    }
                    "Model" | "Checkpoint" | "Model name" | "SD model" => {
                        // Avoid overwriting a good model name with a generic one or repeating info
                        if meta.model == "Unknown" || meta.model.is_empty() {
                            meta.model = val.to_string();
                        } else if val.len() > meta.model.len() && val.starts_with(&meta.model) {
                            meta.model = val.to_string();
                        }
                    }
                    "VAE" => meta.vae = Some(val.to_string()),
                    "Clip skip" => meta.clip_skip = val.parse().ok(),
                    "Denoising strength" => meta.denoising_strength = val.parse().ok(),
                    "Hires upscale" => meta.hires_upscale = val.parse().ok(),
                    "Hires steps" => meta.hires_steps = val.parse().ok(),
                    "Hires upscaler" => meta.hires_upscaler = Some(val.to_string()),
                    "Model hash" => {
                        if meta.model_hash.is_none() || val.len() > meta.model_hash.as_ref().map(|s| s.len()).unwrap_or(0) {
                            meta.model_hash = Some(val.to_string());
                        }
                    }
                    "App" => {
                        let low_val = val.to_lowercase();
                        if low_val.contains("sd.next") || low_val.contains("sdnext") {
                            meta.tool = "SD.Next".to_string();
                        } else if low_val.contains("forge") {
                            meta.tool = "Forge".to_string();
                        } else if low_val.contains("anapnoe") {
                            meta.tool = "Anapnoe".to_string();
                        }
                    }
                    "Version" => {
                        let low_val = val.to_lowercase();
                        if meta.tool == "Automatic1111" {
                            if low_val.contains("vlad")
                                || low_val.contains("next")
                                || low_val.contains("sd.next")
                            {
                                meta.tool = "SD.Next".to_string();
                            } else if low_val.contains("forge") || low_val.starts_with('f') {
                                meta.tool = "Forge".to_string();
                            } else if low_val.contains("anapnoe") {
                                meta.tool = "Anapnoe".to_string();
                            } else if low_val.contains("comfy") {
                                meta.tool = "ComfyUI".to_string();
                            }
                        }
                    }
                    "sd_model_hash" => {
                        if meta.model_hash.is_none() {
                            meta.model_hash = Some(val.to_string());
                        }
                    }
                    "Variation seed" => variation_seed = val.to_string(),
                    "Variation seed strength" => variation_strength = val.to_string(),
                    "Hypernet" | "Hypernetwork" => {
                        let name = val.split('(').next().unwrap_or("").trim().trim_matches('"');
                        if !name.is_empty() && !meta.hypernetworks.contains(&name.to_string()) {
                            meta.hypernetworks.push(name.to_string());
                        }
                    }
                    "TI hashes" => {
                        // Format: "name: hash, name: hash"
                        for part in val.split(',') {
                            if let Some((name, hash)) = part.split_once(':') {
                                let emb_name = name.trim().trim_matches('"');
                                let hash_val = hash.trim();

                                // Validate: Skip obvious false positives from malformed TI hashes
                                // 1. Real embedding names don't contain prompt weighting syntax
                                // 2. Real embedding names are reasonably short
                                // 3. The hash should be alphanumeric (hex hash)
                                let is_valid_name = !emb_name.is_empty()
                                    && !emb_name.contains('(')
                                    && !emb_name.contains(')')
                                    && !emb_name.ends_with('+')
                                    && !emb_name.ends_with('-')
                                    && !emb_name.contains("  ")  // double spaces
                                    && emb_name.len() < 100; // reasonable length

                                // Hash should be alphanumeric and reasonable length (8-64 chars)
                                let is_valid_hash = hash_val.len() >= 8
                                    && hash_val.len() <= 128
                                    && hash_val.chars().all(|c| c.is_ascii_alphanumeric());

                                if is_valid_name
                                    && is_valid_hash
                                    && !meta.embeddings.contains(&emb_name.to_string())
                                {
                                    meta.embeddings.push(emb_name.to_string());
                                }
                            }
                        }
                    }
                    _ => {
                        // Special handling for ControlNet
                        if key.starts_with("ControlNet") {
                            if let Some(start) = val.find("Model: ") {
                                let model_part = &val[start + 7..];
                                let model_name = model_part
                                    .split(',')
                                    .next()
                                    .unwrap_or("")
                                    .trim()
                                    .trim_matches('"');
                                if !model_name.is_empty() {
                                    meta.control_nets.push(model_name.to_string());
                                }
                            }
                        } else if key.starts_with("AddNet Model") {
                            let name = val.split('(').next().unwrap_or("").trim().trim_matches('"');
                            if !name.is_empty() && !meta.loras.contains(&name.to_string()) {
                                meta.loras.push(name.to_string());
                            }
                        } else if key == "Lora hashes" {
                            // Format: "name: hash, name: hash"
                            for part in val.split(',') {
                                if let Some((name, _)) = part.split_once(':') {
                                    let lora_name = name.trim().trim_matches('"');
                                    if !lora_name.is_empty()
                                        && !meta.loras.contains(&lora_name.to_string())
                                    {
                                        meta.loras.push(lora_name.to_string());
                                    }
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
    if let Ok(re) = Regex::new(r"<lora:([^:>]+)(?::([^>]+))?>") {
        for cap in re.captures_iter(&meta.positive_prompt) {
            let lora_name = cap[1].to_string();

            // Extract weight (default 1.0)
            let weight_str = cap.get(2).map(|m| m.as_str()).unwrap_or("1.0");
            let weight = weight_str.parse::<f64>().unwrap_or(1.0);

            // Consistency Rule: Hide 1.0, Show 0.0 and everything else
            let entry = if (weight - 1.0).abs() > f64::EPSILON {
                format!("{} ({:.2})", lora_name, weight)
            } else {
                lora_name
            };

            if !meta.loras.contains(&entry) {
                meta.loras.push(entry);
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
        let meta = extract_a1111_metadata(raw, None);

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
        let meta_app = extract_a1111_metadata(raw_app, None);
        assert_eq!(meta_app.tool, "SD.Next");

        let raw_anapnoe = "Prompt\nSteps: 20, App: anapnoe, Version: 1.0";
        let meta_anapnoe = extract_a1111_metadata(raw_anapnoe, None);
        assert_eq!(meta_anapnoe.tool, "Anapnoe");

        let raw_vlad = "Prompt\nSteps: 20, Version: Vlad Mandic";
        let meta_vlad = extract_a1111_metadata(raw_vlad, None);
        assert_eq!(meta_vlad.tool, "SD.Next");

        let raw_forge = "Prompt\nSteps: 20, Version: forge";
        let meta_forge = extract_a1111_metadata(raw_forge, None);
        assert_eq!(meta_forge.tool, "Forge");

        let raw_forge_v2 = "Prompt\nSteps: 20, Version: f2.0.1v1.10.1-previous-224-g90019688";
        let meta_forge_v2 = extract_a1111_metadata(raw_forge_v2, None);
        assert_eq!(meta_forge_v2.tool, "Forge");
    }

    #[test]
    fn test_extract_a1111_hint_override() {
        let raw = "Positive prompt here\nSteps: 20";
        let meta = extract_a1111_metadata(raw, Some("Anapnoe".to_string()));
        assert_eq!(meta.tool, "Anapnoe");
    }

    #[test]
    fn test_extract_loras() {
        let raw =
            "A beautiful <lora:cool_style:0.8> painting <lora:other_one:1> <lora:zero_test:0>";
        let meta = extract_a1111_metadata(raw, None);
        assert!(meta.loras.contains(&"cool_style (0.80)".to_string()));
        assert!(meta.loras.contains(&"other_one".to_string()));
        assert!(meta.loras.contains(&"zero_test (0.00)".to_string()));
    }

    #[test]
    fn test_a1111_parsing_weird_string() {
        let raw = r#"masterpiece,best quality, newest, absurdres, highres, 1990s style, berserk by Tsutomu Nihei, "A muscular anime knight swinging his sword in a wide arc, sparks flying, surrounded by a battlefield with smoke and fire.",masterpiece,best quality, newest, absurdres, highres, 1990s style, berserk by Tsutomu Nihei, "A muscular anime knight swinging his sword in a wide arc, sparks flying, surrounded by a battlefield with smoke and fire." Negative prompt: low quality,worst quality,normal quality, signature,jpeg artifacts,bad anatomy, old, early, copyright name, watermark, artist name, signature,censor,,low quality,worst quality,normal quality, signature,jpeg artifacts,bad anatomy, old, early, copyright name, watermark, artist name, signature,censor,,low quality,worst quality,normal quality, signature,jpeg artifacts,bad anatomy, old, early, copyright name, watermark, artist name, signature,censor,,low quality,worst quality,normal quality, signature,jpeg artifacts,bad anatomy, old, early, copyright name, watermark, artist name, signature,censor, Steps: 36, Sampler: deis beta, CFG scale: 6.0, Seed: 287184813799736, Size: 896x1152, Model: novaAnimeXL_ilV30HappyNewYear, VAE: sdxl_vae, Clip skip: 1, RNG: CPU, TI hashes: "masterpiece,best quality, newest, absurdres, highres, 1990s style, berserk by Tsutomu Nihei, "A muscular anime knight swinging his sword in a wide arc, sparks flying, surrounded by a battlefield with smoke and fire." , low quality,worst quality,normal quality, signature,jpeg artifacts,bad anatomy, old, early, copyright name, watermark, artist name, signature,censor,,low quality,worst quality,normal quality, signature,jpeg artifacts,bad anatomy, old, early, copyright name, watermark, artist name, signature,censor,", Version: ComfyUI"#;

        let meta = extract_a1111_metadata(raw, None);

        assert_eq!(meta.tool, "ComfyUI");
        assert_eq!(meta.model, "novaAnimeXL_ilV30HappyNewYear");
        assert_eq!(meta.steps, 36);
        assert_eq!(meta.sampler, "deis beta");
    }

    #[test]
    fn test_extract_a1111_with_controlnet() {
        let raw = "parameters: Negative prompt: (hands, feet, teeth), (low resolution, lowres, blurry), (watermark, signature, patreon reward, patreon username), [(worst quality, low quality:1.75), (interlocked finger:1.15), (low resolution, lowres, blurry), (watermark, signature, patreon) (hands, feet, teeth),(zombie,horror)::0.95] Steps: 48, Sampler: Restart, CFG scale: 5, Seed: 83289333, Size: 512x768, Model hash: 41e59d8b2e, Model: realcartoonSpecial_sp1, ControlNet 0: \"Module: ip-adapter_clip_sd15, Model: ip-adapter_sd15_light [932b88cf], Weight: 0.75, Resize Mode: Crop and Resize, Low Vram: False, Processor Res: 512, Guidance Start: 0, Guidance End: 0.77, Pixel Perfect: True, Control Mode: Balanced, Save Detected Map: True\", BMAB_face_option: \"disable_extra_networks=False\", Version: 1.7.0";
        let meta = extract_a1111_metadata(raw, None);

        assert_eq!(meta.model, "realcartoonSpecial_sp1");
        assert_eq!(meta.seed, 83289333);
        assert_eq!(meta.steps, 48);
        assert!(meta
            .control_nets
            .contains(&"ip-adapter_sd15_light [932b88cf]".to_string()));
    }

    #[test]
    fn test_extract_loras_advanced() {
        let raw = "Prompt\nSteps: 20, AddNet Enabled: True, AddNet Module 1: LoRA, AddNet Model 1: some_lora(hash), AddNet Weight A 1: 0.7, Lora hashes: \"lora1: abc, lora2: def\"";
        let meta = extract_a1111_metadata(raw, None);

        assert!(meta.loras.contains(&"some_lora".to_string()));
        assert!(meta.loras.contains(&"lora1".to_string()));
        assert!(meta.loras.contains(&"lora2".to_string()));
    }

    #[test]
    fn test_extract_embeddings_and_hypernets() {
        let raw = "Prompt\nSteps: 20, Hypernet: cool_style(0.8), TI hashes: \"emb1: abc12345, emb2: def67890\"";
        let meta = extract_a1111_metadata(raw, None);

        assert!(meta.hypernetworks.contains(&"cool_style".to_string()));
        assert!(meta.embeddings.contains(&"emb1".to_string()));
        assert!(meta.embeddings.contains(&"emb2".to_string()));
    }

    #[test]
    fn test_ti_hashes_false_positives() {
        // Malformed TI hashes containing prompt weighting syntax
        let raw = r#"Prompt
Steps: 20, TI hashes: "(oil on canvas by Rembrandt van Rijn)+++: invalid, EasyNegative: abc12345def""#;
        let meta = extract_a1111_metadata(raw, None);

        // Should only contain the valid embedding, not the prompt weighting
        assert!(!meta.embeddings.iter().any(|e| e.contains("oil on canvas")));
        assert!(!meta.embeddings.iter().any(|e| e.contains("+++")));
        assert!(meta.embeddings.contains(&"EasyNegative".to_string()));
    }

    #[test]
    fn test_extract_comfyui_jumbled_parameters() {
        let raw = "Model: Osaka[REV3].fp16.safetensors, Seed: 819601553905272, Steps: 36, CFG scale: 6, Sampler: dpmpp_2m, Scheduler: karras, Size: 512x768, Batch size: 1 Negative prompt: Model: Osaka[REV3].fp16.safetensors, Seed: 819601553905272, Steps: 36, CFG scale: 6, Sampler: dpmpp_2m, Scheduler: karras, Size: 512x768, Batch size: 1 Steps: 36, Sampler: dpmpp_2m_karras, CFG scale: 6, Seed: 819601553905272, Size: 512x768, Model: Osaka[REV3].fp16, Version: ComfyUI, Extra info: Model: Osaka[REV3].fp16.safetensors, Seed: 819601553905272, Steps: 36, CFG scale: 6, Sampler: dpmpp_2m, Scheduler: karras, Size: 512x768, Batch size: 1";
        let meta = extract_a1111_metadata(raw, None);
        println!("EXTRACTED META: {:#?}", meta);

        // Current buggy state:
        // - positive_prompt should NOT contain the technical data
        // - negative_prompt should NOT contain the technical data
        // - model should be Osaka[REV3].fp16
        // - sampler should be dpmpp_2m (or dpmpp_2m_karras)

        assert!(meta.positive_prompt.is_empty() || meta.positive_prompt.contains("Extra info"), "Positive prompt should be empty or only contain Extra info, got: {}", meta.positive_prompt);
        assert!(meta.negative_prompt.is_empty(), "Negative prompt should be empty, got: {}", meta.negative_prompt);
        assert_eq!(meta.steps, 36);
        assert_eq!(meta.cfg, 6.0);
        assert_eq!(meta.seed, 819601553905272);
        assert!(meta.model.contains("Osaka[REV3]"));
    }

    #[test]
    fn test_extract_comfyui_mock_sampler() {
        let raw = "Steps: 20, Sampler: _, CFG scale: 5, Seed: 1047146944135898, Size: 512x768, Model: , Version: ComfyUI";
        let meta = extract_a1111_metadata(raw, None);
        
        // Sampler should be Unknown, not "_"
        assert_eq!(meta.sampler, "Unknown");
        assert_eq!(meta.steps, 20);
        assert_eq!(meta.cfg, 5.0);
        assert_eq!(meta.seed, 1047146944135898);
    }
}
