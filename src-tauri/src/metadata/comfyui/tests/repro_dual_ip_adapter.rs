use super::super::extract_comfyui_metadata;
use std::collections::HashMap;

#[test]
fn test_repro_dual_ip_adapter() {
    let workflow_json = r#"
    {
        "18": {"inputs": {"text": ["1818", 0], "parser": "comfy", "mean_normalization": true, "multi_conditioning": true, "use_old_emphasis_implementation": false, "with_SDXL": false, "ascore": 6.0, "width": 1024, "height": 1024, "crop_w": 0, "crop_h": 0, "target_width": 1024, "target_height": 1024, "text_g": "", "text_l": "", "smZ_steps": 1, "clip": ["1409", 0]}, "class_type": "smZ CLIPTextEncode"},
        "1339": {"inputs": {"weight": 0.8, "noise": 0.0, "weight_type": "original", "start_at": 0.0, "end_at": 0.9, "faceid_v2": true, "weight_v2": 1.0, "unfold_batch": false, "ipadapter": ["1343", 0], "clip_vision": ["1340", 0], "insightface": ["1344", 0], "image": ["1868", 0], "model": ["1741", 0]}, "class_type": "IPAdapterApplyFaceID"},
        "1343": {"inputs": {"ipadapter_file": "ip-adapter-faceid-plusv2_sd15.bin"}, "class_type": "IPAdapterModelLoader"},
        "1350": {"inputs": {"weight": 0.4, "noise": 0.0, "weight_type": "original", "start_at": 0.0, "end_at": 0.85, "unfold_batch": false, "ipadapter": ["1351", 0], "clip_vision": ["1340", 0], "image": ["1819", 0], "model": ["1339", 0]}, "class_type": "IPAdapterApply"},
        "1351": {"inputs": {"ipadapter_file": "ip-adapter-full-face_sd15.safetensors"}, "class_type": "IPAdapterModelLoader"},
        "1741": {"inputs": {"lora_name": "ip-adapter-faceid-plusv2_sd15_lora.safetensors", "strength_model": 0.6, "model": ["1114", 1]}, "class_type": "LoraLoaderModelOnly"},
        "9999": {"inputs": {"model": ["1350", 0], "seed": 123, "steps": 20, "cfg": 8.0, "sampler_name": "euler", "scheduler": "normal", "positive": ["18", 0], "negative": ["18", 0], "latent_image": ["1135", 0]}, "class_type": "KSampler"}
    }
    "#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), workflow_json.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    println!("Extracted LoRAs: {:?}", meta.loras);
    println!("Extracted ControlNets: {:?}", meta.control_nets);

    // 1. Check LoraLoaderModelOnly (Should stay in LoRAs)
    let found_lora_loader = meta.loras.iter().any(|l| l.contains("ip-adapter-faceid-plusv2_sd15_lora"));
    assert!(found_lora_loader, "Should detect LoraLoaderModelOnly in LoRAs");

    // 2. Check IPAdapterModelLoader (Should be in ip_adapters, NOT LoRAs)
    let found_ip_loader_in_loras = meta.loras.iter().any(|l| l.contains("ip-adapter-full-face_sd15"));
    assert!(!found_ip_loader_in_loras, "Should NOT detect IPAdapterModelLoader in LoRAs");

    let found_ip_loader_in_ip_adapters = meta.ip_adapters.iter().any(|l| l.contains("ip-adapter-full-face_sd15"));
    assert!(found_ip_loader_in_ip_adapters, "Should detect IPAdapterModelLoader in IP Adapters");
    
    // Debug
    println!("Final LoRAs: {:?}", meta.loras);
    println!("Final IP Adapters: {:?}", meta.ip_adapters);
}
