#[cfg(test)]
mod tests {
    use crate::metadata::comfyui::extract_comfyui_metadata;
    use std::collections::HashMap;

    #[test]
    fn test_sampler_repro_unknown_karras() {
        let mut chunks = HashMap::new();
        
        // This is the "parameters" (A1111 style) part that ComfyUI often embeds
        // specifically using nodes like SDPromptSaver.
        let parameters = r#"(the walking dead comic style:1.3) 1girl, blonde hair, closed mouth, sleeveless denim jacket, green eyes, purple shoe laces, realistic, solo, violette, long sleeves, green eyes, beautiful eyes, masterpiece, high res, pants, mountain backgroundBREAK, Negative prompt: [(hands, feet, teeth), (worst quality, low quality:1.5), (low resolution, blurry, lowres), (text, watermark, signature)::0.95] Steps: 20, Sampler: _, CFG scale: 5, Seed: 1047146944135898, Size: 512x768, Model: , Version: ComfyUI, Extra info: undefined"#;
        
        // This is the ComfyUI "prompt" (API format) part
        let prompt = r#"{
            "1114": {
                "inputs": {
                    "ckpt_name": "forgottenmixTheNovelist_v10Pruned.safetensors",
                    "vae_name": "vae-ft-mse-840000-ema-pruned.safetensors",
                    "model_version": "SDv1 512px",
                    "config_name": "none",
                    "seed": 1047146944135898,
                    "steps": 20,
                    "refiner_start": 0,
                    "cfg": 5,
                    "sampler_name": "dpmpp_2m",
                    "scheduler": "karras",
                    "positive_ascore": 6,
                    "negative_ascore": 6,
                    "aspect_ratio": "custom",
                    "width": 512,
                    "height": 768,
                    "batch_size": 1,
                    "steps_display": "Total steps: 20,\nRefiner start at step: 0 (0%)",
                    "aspect_ratio_display": "Custom aspect ratio: 512 x 768"
                },
                "class_type": "SDParameterGenerator"
            },
            "1146": {
                "inputs": {
                    "filename": "ComfyUI_%time_%seed_%counter",
                    "path": "%date/",
                    "seed": ["1114", 4],
                    "steps": ["1114", 5],
                    "cfg": ["1114", 7],
                    "width": ["1153", 0],
                    "height": ["1153", 1],
                    "positive": ["138", 0],
                    "negative": ["1180", 0],
                    "extension": "png",
                    "calculate_model_hash": false,
                    "lossless_webp": true,
                    "jpg_webp_quality": 100,
                    "date_format": "%Y-%m-%d",
                    "time_format": "%H%M%S",
                    "save_metadata_file": false,
                    "extra_info": "undefined",
                    "images": ["1144", 0]
                },
                "class_type": "SDPromptSaver"
            },
            "1127": {
                "inputs": {
                    "add_noise": "enable",
                    "noise_seed": ["1114", 4],
                    "steps": ["1114", 5],
                    "cfg": ["1114", 7],
                    "sampler_name": ["1114", 8],
                    "scheduler": ["1114", 9],
                    "start_at_step": 0,
                    "end_at_step": 10000,
                    "return_with_leftover_noise": "disable",
                    "model": ["1114", 1],
                    "positive": ["18", 0],
                    "negative": ["561", 0],
                    "latent_image": ["1135", 0]
                },
                "class_type": "KSamplerAdvanced"
            }
        }"#;

        // In a real PNG, "parameters" might be in a tEXt chunk, 
        // and "prompt" in an iTXt/tEXt chunk.
        // SDPromptSaver often embeds the "parameters" into its own output if used.
        // But here we'll assume they are separate chunks as passed to extract_comfyui_metadata.
        chunks.insert("parameters".to_string(), parameters.to_string());
        chunks.insert("prompt".to_string(), prompt.to_string());

        let meta = extract_comfyui_metadata(&chunks);

        println!("Extracted Sampler: {}", meta.sampler);
        
        // The core issue: Sampler should be "dpmpp_2m (karras)", not "Unknown (karras)"
        assert_eq!(meta.sampler, "dpmpp_2m (karras)");
        assert_eq!(meta.steps, 20);
        assert_eq!(meta.cfg, 5.0);
        assert_eq!(meta.seed, 1047146944135898);
        assert!(meta.model.contains("forgottenmixTheNovelist_v10Pruned"));
    }
}
