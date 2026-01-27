use crate::metadata::ImageMetadata;

pub fn parse_a1111_parameters(text: &str) -> ImageMetadata {
    let mut meta = ImageMetadata::default();

    // Simple parser: Split by comma, look for "Key: Value"
    // Note: Parameter string is usually at the end of the text.
    // If text contains "Steps:", we assume the block starts there or near.

    // 1. Extract Negative Prompt (between "Negative prompt:" and "Steps:")
    // NOTE: This assumes standard A1111 format ordering
    let mut clean_text = text;
    if let Some(steps_idx) = text.find("Steps: ") {
        let pre_steps = &text[..steps_idx];
        let pre_steps_lower = pre_steps.to_lowercase();

        if let Some(neg_idx) = pre_steps_lower.find("negative prompt:") {
            let pos_part = &pre_steps[..neg_idx];
            let neg_part = &pre_steps[neg_idx + "negative prompt:".len()..];

            if !pos_part.trim().is_empty() {
                meta.positive_prompt = pos_part.trim().to_string();
            }
            if !neg_part.trim().is_empty() {
                meta.negative_prompt = neg_part.trim().to_string();
            }
        } else {
            // No negative prompt label, everything before Steps is positive
            if !pre_steps.trim().is_empty() {
                meta.positive_prompt = pre_steps.trim().to_string();
            }
        }

        // Advance to parameters
        clean_text = &text[steps_idx..];
    }

    let parts: Vec<&str> = clean_text.split(',').collect();
    for part in parts {
        let part = part.trim();
        if let Some((key, val)) = part.split_once(": ") {
            match key {
                "Steps" => {
                    if let Ok(v) = val.trim().parse::<u32>() {
                        meta.steps = v;
                    }
                }
                "CFG scale" => {
                    if let Ok(v) = val.trim().parse::<f32>() {
                        meta.cfg = v;
                    }
                }
                "Seed" => {
                    if let Ok(v) = val.trim().parse::<i64>() {
                        meta.seed = v;
                    }
                }
                "Sampler" => meta.sampler = val.trim().to_string(),
                "Scheduler" => {
                    if !meta.sampler.is_empty() {
                        meta.sampler = format!("{} ({})", meta.sampler, val.trim());
                    }
                }
                "Model" => {
                    let m = val.trim();
                    if m != "None" {
                        meta.model = m.replace(".safetensors", "").replace(".ckpt", "");
                    }
                }
                _ => {}
            }
        }
    }

    meta
}
