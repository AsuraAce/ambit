use crate::metadata::comfyui::extract_comfyui_metadata;
use std::collections::HashMap;

#[test]
fn test_repro_undefined_prompts_and_bogus_steps() {
    let mut chunks = HashMap::new();

    // The "parameters" chunk with the reported shape
    let parameters = r#"undefined ,, Negative prompt: undefined Steps: 1024, Sampler: dpmpp_2m_karras, CFG scale: 7.0, Seed: 1234567890, Size: 1024x1536, Model: revAnimated_v122, Version: ComfyUI"#;
    chunks.insert("parameters".to_string(), parameters.to_string());

    // A synthetic workflow graph with the reported shape
    let prompt_json = r#"{
        "1149": {
            "inputs": {
                "text": "(((still life of a red apple on a wooden table) with a white cloth, a glass of water, and soft window light.)),"
            },
            "class_type": "ShowText"
        },
        "1153": {
            "inputs": {
                "steps": 20,
                "sampler_name": ["1156", 0],
                "model": ["1148", 0]
            },
            "class_type": "KSampler //Inspire"
        },
        "1152": {
            "inputs": {
                "steps": ["1159", 0],
                "positive": ["1135", 0],
                "negative": ["1145", 0],
                "images": ["1151", 0]
            },
            "class_type": "SDPromptSaver"
        },
        "1151": {
            "inputs": {
                "samples": ["1153", 0]
            },
            "class_type": "VAEDecode"
        },
        "1135": {
            "inputs": {
                "text1": ["1149", 0]
            },
            "class_type": "Concat Text _O"
        },
        "1159": {
            "inputs": {
                "shortside": 1024
            },
            "class_type": "Resolutions by Ratio (WLSH)"
        }
    }"#;
    chunks.insert("prompt".to_string(), prompt_json.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    // CURRENT FAILURES EXPECTED:
    // meta.positive_prompt will be "undefined ,,"
    // meta.negative_prompt will be "undefined"
    // meta.steps will be 1024 (from parameters parsing)

    assert_ne!(meta.positive_prompt, "undefined ,,");
    assert_ne!(meta.negative_prompt, "undefined");
    assert!(meta.positive_prompt.contains("red apple on a wooden table"));
    // assert!(meta.negative_prompt.contains("low quality"));

    // Should favor the KSampler steps (20) over the saver steps (1024)
    // or at least NOT pick 1024.
    assert_eq!(meta.steps, 20);
}
