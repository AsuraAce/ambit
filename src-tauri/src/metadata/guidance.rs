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
        name.replace(".safetensors", "")
            .replace(".ckpt", "")
            .replace(".pth", "")
            .replace(".bin", "")
            .replace(".pt", "")
            .split('(')
            .next()
            .unwrap_or("")
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

        // 1. IP-Adapter detection
        if n.contains("ip-adapter") || n.contains("ip_adapter") || n.contains("ipadapter") {
            let subtype = if n.contains("faceid") {
                "faceid"
            } else if n.contains("plus") && (n.contains("face") || n.contains("full")) {
                "full-face"
            } else if n.contains("plus") {
                "plus"
            } else if n.contains("light") {
                "light"
            } else if n.contains("composition") {
                "composition"
            } else {
                "standard"
            };
            return Some((GuidanceCategory::IPAdapter, subtype.to_string()));
        }

        // 2. ControlNet / T2I-Adapter detection
        let is_controlnet = n.contains("controlnet") || n.contains("control_") || n.contains("cnet");
        let is_t2i = (n.contains("t2i") && n.contains("adapter")) || n.contains("t2iadapter");

        if !is_controlnet && !is_t2i {
            // Try subtype matching even without specific category keywords
            // but only if it's a very clear match
            let subtypes = [
                "canny", "depth", "midas", "leres", "zoe", "openpose", "pose",
                "scribble", "lineart", "softedge", "soft_edge", "soft-edge", "mlsd", "ade20k", "ip2p",
                "normal", "tile", "inpaint", "shuffle", "recolor"
            ];
            if !subtypes.iter().any(|&s| n.contains(s)) {
                return None;
            }
        }

        let category = if is_t2i {
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
        } else if n.contains("scribble") || n.contains("hed") || n.contains("softedge") || n.contains("soft_edge") || n.contains("soft-edge") {
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
        } else if n.contains("sketch") {
            "scribble"
        } else {
            "other"
        };

        Some((category, subtype.to_string()))
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
}
