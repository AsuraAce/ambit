use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum GuidanceCategory {
    ControlNet,
    IPAdapter,
    T2IAdapter,
    Other,
}

impl GuidanceCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ControlNet => "ControlNet",
            Self::IPAdapter => "IP-Adapter",
            Self::T2IAdapter => "T2I-Adapter",
            Self::Other => "Other",
        }
    }
}

pub struct GuidanceClassifier;

impl GuidanceClassifier {
    /// Cleans a model name by removing common extensions and weights.
    pub fn clean_name(name: &str) -> String {
        // 1. Extract basename (handle both / and \)
        let basename = name
            .split(|c| c == '/' || c == '\\')
            .last()
            .unwrap_or(name);

        // 2. Remove extensions and common generic suffixes, then normalize
        basename
            .replace(".safetensors", "")
            .replace(".ckpt", "")
            .replace(".pth", "")
            .replace(".bin", "")
            .replace(".pt", "")
            .split('(')
            .next()
            .unwrap_or("")
            .to_lowercase()
            .replace(' ', "_")
            .replace('-', "_")
            .trim()
            .to_string()
    }

    /// Classifies a guidance model based on its name and optional hash.
    /// Returns (Category, Subtype) if classified, else None.
    pub fn classify(name: &str, hash: Option<&str>) -> Option<(GuidanceCategory, String)> {
        let cleaned = Self::clean_name(name);
        
        // Layer 1: Signatures (Hashes)
        if let Some(h) = hash {
            if let Some(result) = Self::match_signature(h) {
                return Some(result);
            }
        }

        // Layer 2: Heuristics (Filename/Name)
        Self::match_heuristics(&cleaned)
    }

    fn match_signature(hash: &str) -> Option<(GuidanceCategory, String)> {
        // Common hashes (Layer 1)
        // Note: These are 'AutoV2' or short hashes commonly found in metadata
        match hash {
            // --- IP-Adapters (Standard/Plus/Face) ---
            "932b88cf" | "d3e09866" | "1ea82f05" => Some((GuidanceCategory::IPAdapter, "plus".to_string())),
            "ac2342c3" | "1894d07b" => Some((GuidanceCategory::IPAdapter, "faceid".to_string())),
            "7f21a4b5" | "de70a1a8" => Some((GuidanceCategory::IPAdapter, "full-face".to_string())),
            "893d2892" | "5833c8f8" => Some((GuidanceCategory::IPAdapter, "standard".to_string())),
            
            // --- ControlNets (v1.1 SD1.5) ---
            "cc498871" | "f2549278" => Some((GuidanceCategory::ControlNet, "canny".to_string())),
            "f26f6342" | "97a6e70d" => Some((GuidanceCategory::ControlNet, "depth".to_string())),
            "88e367c3" | "75ca82ea" => Some((GuidanceCategory::ControlNet, "pose".to_string())),
            "043743ec" | "64f3310d" => Some((GuidanceCategory::ControlNet, "scribble".to_string())),
            "25ea4b20" | "3535966a" => Some((GuidanceCategory::ControlNet, "lineart".to_string())),
            "79e345cb" | "3705ee1a" => Some((GuidanceCategory::ControlNet, "normal".to_string())),
            "9cda02fd" | "95333f2a" => Some((GuidanceCategory::ControlNet, "tile".to_string())),
            "a89f92e4" | "77977a45" => Some((GuidanceCategory::ControlNet, "inpaint".to_string())),
            
            // --- ControlNets (SDXL) ---
            "9329158c" => Some((GuidanceCategory::ControlNet, "canny".to_string())),
            "1648a74e" => Some((GuidanceCategory::ControlNet, "depth".to_string())),
            "466e0767" => Some((GuidanceCategory::ControlNet, "openpose".to_string())),

            _ => None,
        }
    }

    fn match_heuristics(name: &str) -> Option<(GuidanceCategory, String)> {
        let n = name.to_lowercase();

        // 1. Check for clear prefixes first
        let is_ip_adapter_prefix = n.contains("ip-adapter") || n.contains("ip_adapter") || n.contains("ipadapter") || n.contains("ip adapter") || n.contains("ipad") || n.contains("ip_");
        let is_controlnet_prefix = n.contains("controlnet") || n.contains("control_") || n.contains("cnet");
        let is_t2i_prefix = (n.contains("t2i") && n.contains("adapter")) || n.contains("t2iadapter");

        // 2. Identify strong subtypes
        let has_cnet_subtype = n.contains("canny") || n.contains("depth") || n.contains("midas") || n.contains("leres") || 
                                n.contains("zoe") || n.contains("pose") || n.contains("openpose") || n.contains("scribble") || 
                                n.contains("lineart") || n.contains("softedge") || n.contains("soft_edge") || n.contains("soft-edge") || 
                                n.contains("mlsd") || n.contains("tile") || n.contains("resample") || n.contains("inpaint") || 
                                n.contains("shuffle") || n.contains("recolor") || n.contains("hed") || n.contains("bae") || 
                                n.contains("seg") || n.contains("segmentation") || n.contains("ade20k") || n.contains("sketch");

        let has_ip_subtype = n.contains("faceid") || n.contains("portrait") || n.contains("insightface") || n.contains("reference");
        
        // face and plus are shared but mostly IP-Adapter
        let has_shared_ip_keyword = n.contains("face") || n.contains("plus") || n.contains("full");

        // 3. Classification Logic
        
        // IP-Adapter wins if prefix is present OR strong IP subtype is present AND no strong CNet subtype
        if is_ip_adapter_prefix || (has_ip_subtype && !has_cnet_subtype) || (has_shared_ip_keyword && !is_controlnet_prefix && !has_cnet_subtype) || (n.contains("precise") && !is_controlnet_prefix && !has_cnet_subtype) {
            // Note: "precise" can be Canny, but in a generic context (like "Precise Reference") it's often IPA.
            // If it also contains "canny", has_cnet_subtype will be true and we might want to prioritize CNet.
            // But let's check for IPA subtype first.
            
            let subtype = if n.contains("faceid") && n.contains("plus") {
                "faceid-plus"
            } else if n.contains("faceid") || n.contains("insightface") {
                "faceid"
            } else if n.contains("portrait") {
                "portrait"
            } else if (n.contains("face") || n.contains("full")) && n.contains("plus") {
                "plus-face"
            } else if n.contains("face") || n.contains("full") {
                "full-face"
            } else if n.contains("plus") || n.contains("vit-h") || n.contains("vit_h") || n.contains("precise") || n.contains("reference") {
                "plus" // "plus" is the default for high-quality/reference
            } else if n.contains("light") {
                "light"
            } else if n.contains("composition") {
                "composition"
            } else if n.contains("style") {
                "style"
            } else {
                "standard"
            };
            return Some((GuidanceCategory::IPAdapter, subtype.to_string()));
        }

        // ControlNet / T2I-Adapter wins if prefix is present OR strong CNet subtype is present
        if is_controlnet_prefix || is_t2i_prefix || has_cnet_subtype {
            let category = if is_t2i_prefix {
                GuidanceCategory::T2IAdapter
            } else {
                GuidanceCategory::ControlNet
            };

            let subtype = if n.contains("canny") {
                "canny"
            } else if n.contains("depth") || n.contains("midas") || n.contains("leres") || n.contains("zoe") {
                "depth"
            } else if n.contains("pose") || n.contains("openpose") {
                "pose"
            } else if n.contains("scribble") || n.contains("hed") || n.contains("softedge") || n.contains("soft_edge") || n.contains("soft-edge") || n.contains("sketch") {
                "scribble"
            } else if n.contains("lineart") {
                "lineart"
            } else if n.contains("normal") || n.contains("bae") {
                "normal"
            } else if n.contains("inpaint") {
                "inpaint"
            } else if n.contains("tile") || n.contains("resample") {
                "tile"
            } else if n.contains("mlsd") {
                "mlsd"
            } else if n.contains("seg") || n.contains("segmentation") || n.contains("ade20k") {
                "segmentation"
            } else if n.contains("ip2p") || n.contains("instruct") {
                "ip2p"
            } else if n.contains("shuffle") {
                "shuffle"
            } else if n.contains("recolor") {
                "recolor"
            } else if n.contains("precise") {
                "canny" 
            } else {
                "other"
            };

            return Some((category, subtype.to_string()));
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heuristic_classification() {
        assert_eq!(GuidanceClassifier::classify("control_v11p_sd15_canny", None), Some((GuidanceCategory::ControlNet, "canny".to_string())));
        assert_eq!(GuidanceClassifier::classify("ip-adapter-plus_sd15", None), Some((GuidanceCategory::IPAdapter, "plus".to_string())));
        assert_eq!(GuidanceClassifier::classify("t2iadapter_depth_sd15v2", None), Some((GuidanceCategory::T2IAdapter, "depth".to_string())));
        assert_eq!(GuidanceClassifier::classify("control_v11e_sd15_shuffle", None), Some((GuidanceCategory::ControlNet, "shuffle".to_string())));
        assert_eq!(GuidanceClassifier::classify("control_v11u_sdXL_recolor", None), Some((GuidanceCategory::ControlNet, "recolor".to_string())));
    }

    #[test]
    fn test_softedge_classification() {
        assert_eq!(GuidanceClassifier::classify("control_v11p_sd15_softedge", None), Some((GuidanceCategory::ControlNet, "scribble".to_string())));
        assert_eq!(GuidanceClassifier::classify("control_v11p_sd15_soft_edge", None), Some((GuidanceCategory::ControlNet, "scribble".to_string())));
        assert_eq!(GuidanceClassifier::classify("control-v11p-sd15-soft-edge", None), Some((GuidanceCategory::ControlNet, "scribble".to_string())));
    }

    #[test]
    fn test_signature_classification() {
        // Matches IP-Adapter FaceID even if name is generic
        assert_eq!(GuidanceClassifier::classify("model.bin", Some("ac2342c3")), Some((GuidanceCategory::IPAdapter, "faceid".to_string())));
    }

    #[test]
    fn test_ip_adapter_refinement() {
        assert_eq!(GuidanceClassifier::classify("ip_adapter_plus_face_sdxl", None), Some((GuidanceCategory::IPAdapter, "plus-face".to_string())));
        assert_eq!(GuidanceClassifier::classify("IP Adapter SDXL", None), Some((GuidanceCategory::IPAdapter, "standard".to_string())));
        assert_eq!(GuidanceClassifier::classify("ip_adapter_plus_sdxl", None), Some((GuidanceCategory::IPAdapter, "plus".to_string())));
        assert_eq!(GuidanceClassifier::classify("ip_adapter_sdxl_vit_h", None), Some((GuidanceCategory::IPAdapter, "plus".to_string())));
        assert_eq!(GuidanceClassifier::classify("ip-adapter-faceid-plus_sd15", None), Some((GuidanceCategory::IPAdapter, "faceid-plus".to_string())));
        assert_eq!(GuidanceClassifier::classify("ip-adapter_style_sdxl", None), Some((GuidanceCategory::IPAdapter, "style".to_string())));
        
        // Aggressive checks
        assert_eq!(GuidanceClassifier::classify("face", None), Some((GuidanceCategory::IPAdapter, "full-face".to_string())));
        assert_eq!(GuidanceClassifier::classify("plus face", None), Some((GuidanceCategory::IPAdapter, "plus-face".to_string())));
        assert_eq!(GuidanceClassifier::classify("ipad_plus", None), Some((GuidanceCategory::IPAdapter, "plus".to_string())));
        assert_eq!(GuidanceClassifier::classify("ip_plus_face", None), Some((GuidanceCategory::IPAdapter, "plus-face".to_string())));
    }

    #[test]
    fn test_path_cleaning() {
        assert_eq!(GuidanceClassifier::clean_name("C:\\models\\ip-adapter-plus.safetensors"), "ip_adapter_plus");
        assert_eq!(GuidanceClassifier::clean_name("/usr/share/models/controlnet/canny.bin"), "canny");
        
        // Consolidation tests
        assert_eq!(GuidanceClassifier::clean_name("IP Adapter SDXL"), "ip_adapter_sdxl");
        assert_eq!(GuidanceClassifier::clean_name("ip-adapter_sd15"), "ip_adapter_sd15");
        assert_eq!(GuidanceClassifier::clean_name("ip_adapter_sd15"), "ip_adapter_sd15");
    }

    #[test]
    fn test_cnet_alias() {
        assert_eq!(GuidanceClassifier::classify("cnet_canny", None), Some((GuidanceCategory::ControlNet, "canny".to_string())));
        assert_eq!(GuidanceClassifier::classify("Precise Reference", None), Some((GuidanceCategory::IPAdapter, "plus".to_string())));
        
        // Aggressive subtype checks
        assert_eq!(GuidanceClassifier::classify("canny", None), Some((GuidanceCategory::ControlNet, "canny".to_string())));
        assert_eq!(GuidanceClassifier::classify("depth", None), Some((GuidanceCategory::ControlNet, "depth".to_string())));
        assert_eq!(GuidanceClassifier::classify("tile", None), Some((GuidanceCategory::ControlNet, "tile".to_string())));
        assert_eq!(GuidanceClassifier::classify("openpose", None), Some((GuidanceCategory::ControlNet, "pose".to_string())));

        // Combined checks
        assert_eq!(GuidanceClassifier::classify("cnet_precise_depth", None), Some((GuidanceCategory::ControlNet, "depth".to_string())));
    }
}
