use regex::Regex;
use super::ImageMetadata;

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
            if depth > 0 { depth -= 1; }
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
    let mut params_line = params_lines.iter().find(|l| l.starts_with("Steps: ")).cloned().unwrap_or_default();
    
    // Fallback: If strict parsing failed, but text contains "Steps: ", try to extract it from the raw blob
    if params_line.is_empty() && sanitized_text.contains("Steps: ") {
        if let Some(pos) = sanitized_text.find("Steps: ") {
            // Find the start of the line containing "Steps: "
            let start_of_line = sanitized_text[..pos+6].rfind('\n').map(|idx| idx + 1).unwrap_or(0);
            let tail = &sanitized_text[start_of_line..];
            params_line = tail.lines().next().unwrap_or("").to_string();
            
            // Also try to recover positive/negative if they were missed due to single-line format
            // This is a heuristic attempt for the "JK" node format
            if meta.negative_prompt.is_empty() {
                 if let Some(neg_pos) = sanitized_text.find("Negative prompt: ") {
                     if neg_pos < pos {
                         let neg_part = &sanitized_text[neg_pos..pos];
                         meta.negative_prompt = neg_part.replace("Negative prompt: ", "").trim().to_string();
                         
                         // And Positive is likely everything before Negative
                         if meta.positive_prompt.is_empty() {
                             meta.positive_prompt = sanitized_text[..neg_pos].trim().to_string();
                         }
                     }
                 }
            }
        }
    }

    // Extract Hypernetworks from positive prompt
    if let Ok(re) = Regex::new(r"<hypernet:([^:>]+)(?::[^>]+)?>") {
        for cap in re.captures_iter(&meta.positive_prompt) {
            let hn_name = cap[1].to_string();
            if !meta.hypernetworks.contains(&hn_name) {
                meta.hypernetworks.push(hn_name);
            }
        }
    }

    if params_line.contains("Steps: ") {
        // If the parameters line contains prompt text before "Steps: ", try to isolate parameters
        if let Some(pos) = params_line.find("Steps: ") {
            if pos > 0 {
                // We'll use everything from Steps: onwards for pairs, 
                // as everything before it on the same line is likely a dangling prompt
                params_line = params_line[pos..].to_string();
            }
        }
        let pairs = split_a1111_params(&params_line);
        let mut variation_seed = String::new();
        let mut variation_strength = String::new();

        for pair in pairs {
            if let Some((key, val)) = pair.split_once(": ") {
                let key = key.trim();
                let val = val.trim().trim_matches('"');
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
                        } else if low_val.contains("anapnoe") {
                            meta.tool = "Anapnoe".to_string();
                        }
                    }
                    "Version" => {
                        let low_val = val.to_lowercase();
                        if meta.tool == "Automatic1111" {
                             if low_val.contains("vlad") || low_val.contains("next") || low_val.contains("sd.next") {
                                 meta.tool = "SD.Next".to_string();
                             } else if low_val.contains("forge") || low_val.starts_with('f') {
                                 meta.tool = "Forge".to_string();
                             } else if low_val.contains("anapnoe") {
                                 meta.tool = "Anapnoe".to_string();
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
                    "Hypernet" | "Hypernetwork" => {
                        let name = val.split('(').next().unwrap_or("").trim().trim_matches('"');
                        if !name.is_empty() && !meta.hypernetworks.contains(&name.to_string()) {
                            meta.hypernetworks.push(name.to_string());
                        }
                    }
                    "TI hashes" => {
                        // Format: "name: hash, name: hash"
                        for part in val.split(',') {
                            if let Some((name, _)) = part.split_once(':') {
                                let emb_name = name.trim().trim_matches('"');
                                if !emb_name.is_empty() && !meta.embeddings.contains(&emb_name.to_string()) {
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
                                let model_name = model_part.split(',').next().unwrap_or("").trim().trim_matches('"');
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
                                    if !lora_name.is_empty() && !meta.loras.contains(&lora_name.to_string()) {
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
        let raw = "A beautiful <lora:cool_style:0.8> painting <lora:other_one:1>";
        let meta = extract_a1111_metadata(raw, None);
        assert!(meta.loras.contains(&"cool_style".to_string()));
        assert!(meta.loras.contains(&"other_one".to_string()));
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
        assert!(meta.control_nets.contains(&"ip-adapter_sd15_light [932b88cf]".to_string()));
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
        let raw = "Prompt\nSteps: 20, Hypernet: cool_style(0.8), TI hashes: \"emb1: abc, emb2: def\"";
        let meta = extract_a1111_metadata(raw, None);
        
        assert!(meta.hypernetworks.contains(&"cool_style".to_string()));
        assert!(meta.embeddings.contains(&"emb1".to_string()));
        assert!(meta.embeddings.contains(&"emb2".to_string()));
    }
}
