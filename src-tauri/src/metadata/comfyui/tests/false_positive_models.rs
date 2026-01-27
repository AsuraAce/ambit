use super::super::extract_comfyui_metadata;
use std::collections::HashMap;

#[test]
fn test_upscale_model_false_positive() {
    let workflow = r#"{"id":"9ae6082b-c7f4-433c-9971-7a8f65a3ea65","nodes":[{"id":56,"type":"UpscaleModelLoader","widgets_values":["4x_NMKD-Siax_200k.pth"]},{"id":86,"type":"CheckpointLoaderSimple","widgets_values":["zImageTurbo\\moodyPornMix_zitV6.safetensors"]},{"id":44,"type":"KSampler","widgets_values":[896062275555069,"randomize",8,1,"res_multistep","simple",1]}],"links":[]}"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);
    
    println!("Extracted Model: {}", meta.model);

    // Should NOT be the upscale model
    assert!(!meta.model.contains("4x_NMKD"), "Should not extract upscale model as main model");
    
    // Should be the actual checkpoint
    assert!(meta.model.contains("moodyPornMix"), "Should extract the actual checkpoint. Got: {}", meta.model);
}

#[test]
fn test_bbox_model_false_positive() {
     let workflow = r#"{"id":"bbox_test","nodes":[{"id":100,"type":"UltralyticsDetectorProvider","widgets_values":["bbox/face_yolov8m.pt"]},{"id":86,"type":"CheckpointLoaderSimple","widgets_values":["real_model.safetensors"]}],"links":[]}"#;
     
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);
    assert!(!meta.model.contains("yolov8m"), "Should not extract bbox model");
    assert!(meta.model.contains("real_model"), "Should extract real model");
}
