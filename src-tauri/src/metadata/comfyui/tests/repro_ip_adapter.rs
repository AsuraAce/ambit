use super::super::extract_comfyui_metadata;
use std::collections::HashMap;

#[test]
fn test_repro_ip_adapter_lora() {
    let workflow_json = r#"
    {
        "last_node_id": 1949,
        "last_link_id": 2762,
        "nodes": [
            {
                "id": 1741,
                "type": "LoraLoaderModelOnly",
                "widgets_values": ["ip-adapter-faceid-plusv2_sd15_lora.safetensors", 0.6],
                "outputs": [{"name": "MODEL", "type": "MODEL", "links": [2365], "shape": 3, "slot_index": 0}],
                "properties": {"Node name for S&R": "LoraLoaderModelOnly"}
            },
            {
                "id": 1339,
                "type": "IPAdapterApplyFaceID",
                "inputs": [
                    {"name": "ipadapter", "type": "IPADAPTER", "link": 1835},
                    {"name": "clip_vision", "type": "CLIP_VISION", "link": 1836},
                    {"name": "insightface", "type": "INSIGHTFACE", "link": 1837},
                    {"name": "image", "type": "IMAGE", "link": 2724},
                    {"name": "model", "type": "MODEL", "link": 2365},
                    {"name": "attn_mask", "type": "MASK", "link": null}
                ],
                "outputs": [{"name": "MODEL", "type": "MODEL", "links": [2367]}],
                "properties": {"Node name for S&R": "IPAdapterApplyFaceID"}
            },
            {
                "id": 1350,
                "type": "IPAdapterApply",
                "inputs": [
                     {"name": "model", "type": "MODEL", "link": 2367}
                ],
                "outputs": [{"name": "MODEL", "type": "MODEL", "links": [2693]}]
            },
            {
                 "id": 1945,
                 "type": "KSampler //Inspire",
                 "inputs": [
                     {"name": "model", "type": "MODEL", "link": 2693},
                     {"name": "positive", "type": "CONDITIONING", "link": 9902}
                 ],
                 "widgets_values": [511923121704050, "randomize", 20, 8, "dpmpp_2m", "karras", 1, "GPU(=A1111)", "incremental", 0, 0],
                 "properties": {"Node name for S&R": "KSampler //Inspire"}
            },
            {
                "id": 9991,
                "type": "ControlNetLoader",
                "widgets_values": ["control_v11p_sd15_openpose.pth"],
                "outputs": [{"name": "CONTROL_NET", "type": "CONTROL_NET", "links": [9901]}]
            },
            {
                "id": 9992,
                "type": "ControlNetApply",
                "inputs": [
                    {"name": "control_net", "type": "CONTROL_NET", "link": 9901},
                    {"name": "positive", "type": "CONDITIONING", "link": null},
                    {"name": "image", "type": "IMAGE", "link": null}
                ],
                "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": [9902]}]
            }
        ],
        "links": [
            [2365, 1741, 0, 1339, 4, "MODEL"],
            [2367, 1339, 0, 1350, 0, "MODEL"],
            [2693, 1350, 0, 1945, 0, "MODEL"],
            [9901, 9991, 0, 9992, 0, "CONTROL_NET"],
            [9902, 9992, 0, 1945, 1, "CONDITIONING"]
        ]
    }
    "#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow_json.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    println!("Full Metadata: {:?}", meta);
    println!("Extracted LoRAs: {:?}", meta.loras);
    println!("Extracted ControlNets: {:?}", meta.control_nets);
    
    // IP Adapter check
    let found_ip_adapter = meta.loras.iter().any(|l| l.contains("ip-adapter"));
    println!("Found IP Adapter in LoRAs: {}", found_ip_adapter);
    assert!(found_ip_adapter, "Should find the IP-Adapter LoRA (current behavior)");
    
    // ControlNet check
    let found_cn = meta.control_nets.iter().any(|cn| cn.contains("openpose"));
    println!("Found ControlNet: {}", found_cn);
    assert!(found_cn, "Should find the ControlNet");
}

