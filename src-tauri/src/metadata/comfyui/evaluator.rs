use super::graph::{ComfyGraph, get_node_type, get_node_input_link, get_node_param};
use super::heuristics::find_wireless_node;
use crate::metadata::ImageMetadata;
use serde_json::Value;
use std::collections::HashSet;

pub struct ComfyEvaluator<'a> {
    graph: &'a ComfyGraph,
}

impl<'a> ComfyEvaluator<'a> {
    pub fn new(graph: &'a ComfyGraph) -> Self {
        Self { graph }
    }

    pub fn split_sampler_scheduler(sampler_field: &str) -> (Option<String>, Option<String>) {
        if let Some((samp, sched)) = sampler_field.split_once(' ') {
            // Check if second part looks like a scheduler
            let common_schedulers = ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"];
            let s_clean = sched.trim().trim_matches(')').trim_matches('(');
            if common_schedulers.contains(&s_clean) {
                return (Some(samp.to_string()), Some(s_clean.to_string()));
            }
        }
        (Some(sampler_field.to_string()), None)
    }

    /// Primary entry point: Evaluate the graph from likely output nodes
    pub fn extract(&self) -> ImageMetadata {
        let mut meta = ImageMetadata::default();
        let mut visited_samplers = HashSet::new();

        // 1. Find Output Nodes (SaveImage, PreviewImage)
        let output_nodes = self.find_output_nodes();

        // 2. Backtrack to find the ROOT Sampler
        for output_id in output_nodes {
            if let Some(node) = self.graph.get_node(&output_id) {
                // Determine if this output is muted
                if self.is_muted(node) {
                    continue;
                }

                // Trace back to find a Sampler
                if let Some(sampler_id) = self.find_upstream_sampler(&output_id, 0) {
                    if visited_samplers.contains(&sampler_id) {
                        continue;
                    }
                    visited_samplers.insert(sampler_id.clone());

                    // Found a sampler! Now find the ROOT sampler (handle Refiners)
                    let root_sampler_id = self.find_root_sampler_id(&sampler_id);
                    
                    if let Some(root_node) = self.graph.get_node(&root_sampler_id) {
                        // Extract metadata from this Root Sampler
                        let partial = self.extract_from_sampler(root_node);
                        meta.merge(partial);
                    }
                }
            }
        }

        meta
    }

    /// Secondary entry point: Scans for ANY KSampler if output traversal failed.
    /// This is crucial for partial graphs (unit tests) or disconnected workflows.
    pub fn extract_from_all_samplers(&self) -> ImageMetadata {
        let mut meta = ImageMetadata::default();
        
        for (id, node) in self.graph.nodes() {
            let t = get_node_type(node);
            // Ignore builder parts like KSamplerSelect, BasicScheduler
            if (t.contains("KSampler") && !t.contains("Select") && !t.contains("Provider")) || t == "SamplerCustomAdvanced" {
                 // We found a sampler. Extract from it.
                 // We might want to prioritize "active" ones (not muted)?
                 if !self.is_muted(node) {
                     let partial = self.extract_from_sampler(node);
                     // Merge carefully? Or just take the first one that has data?
                     // If we have multiple samplers, mixing metadata is risky.
                     // But typically finding ONE valid one is enough.
                     if partial.steps > 0 || !partial.model.is_empty() {
                         meta.merge(partial);
                         // If we found good data, stop?
                         // Let's stop if we have steps + model
                         if meta.steps > 0 && !meta.model.is_empty() {
                             return meta;
                         }
                     }
                 }
            }
        }
        meta
    }

    fn find_output_nodes(&self) -> Vec<String> {
        let mut nodes = Vec::new();
        for (id, node) in self.graph.nodes() {
            let t = get_node_type(node);
            if t == "SaveImage" || t == "PreviewImage" || t == "ImageSave" || t.contains("SaveImage") {
                nodes.push(id.clone());
            }
        }
        // Sort for deterministic order
        nodes.sort();
        nodes
    }

    fn is_muted(&self, node: &Value) -> bool {
        // mode 2 = Muted, mode 4 = Bypassed
        // We treat Muted as "Dead End". Bypassed is "Pass Through" (handled in traversal).
        if let Some(mode) = node.get("mode").and_then(|v| v.as_i64()) {
            return mode == 2;
        }
        false
    }
    
    // Check if node is bypassed (mode 4)
    fn is_bypassed(&self, node: &Value) -> bool {
        if let Some(mode) = node.get("mode").and_then(|v| v.as_i64()) {
            return mode == 4;
        }
        false
    }

    /// Walk upstream from a node input to find a KSampler
    fn find_upstream_sampler(&self, start_id: &str, depth: u32) -> Option<String> {
        if depth > 50 { return None; }
        
        let node = self.graph.get_node(start_id)?;
        
        // Is this node a sampler?
        let t = get_node_type(node);
        if t.contains("KSampler") || t == "SamplerCustomAdvanced" {
             return Some(start_id.to_string());
        }

        // Trace inputs usually linking to samples/images
        let image_inputs = ["images", "image", "samples"];
        for input_name in image_inputs {
             if let Some(source_id) = self.get_source_id(node, input_name) {
                 if let Some(found) = self.find_upstream_sampler(&source_id, depth + 1) {
                     return Some(found);
                 }
             }
        }

        None
    }

    /// Handle "Refiner" logic: If a sampler's 'latent_image' comes from another Sampler,
    /// go deeper. Return the ID of the base sampler.
    fn find_root_sampler_id(&self, start_sampler_id: &str) -> String {
        let mut current_id = start_sampler_id.to_string();
        let mut depth = 0;

        while depth < 10 {
            if let Some(node) = self.graph.get_node(&current_id) {
                // Look at 'latent_image' (standard) or 'samples' input
                if let Some(source_id) = self.get_source_id(node, "latent_image") {
                     // Check if source is also a sampler
                     if let Some(source_node) = self.graph.get_node(&source_id) {
                         let t = get_node_type(source_node);
                         if t.contains("KSampler") || t == "SamplerCustomAdvanced" {
                             // It's a chain! Move upstream.
                             current_id = source_id;
                             depth += 1;
                             continue;
                         }
                     }
                }
            }
            break;
        }
        current_id
    }

    /// Main logic to pull Steps, CFG, Model, etc from a generic Sampler node
    fn extract_from_sampler(&self, node: &Value) -> ImageMetadata {
        let mut meta = ImageMetadata::default();

        // 1. Direct Parameters (Steps, CFG, Seed)
        if let Some(v) = self.evaluate_number(node, "steps", 500) { meta.steps = v as u32; }
        if let Some(v) = self.evaluate_float(node, "cfg", 200.0) { meta.cfg = v as f32; }
        if let Some(v) = self.evaluate_number(node, "seed", i64::MAX) { meta.seed = v; }
        else if let Some(v) = self.evaluate_number(node, "noise_seed", i64::MAX) { meta.seed = v; }

        // 2. Sampler Name / Scheduler
        let mut sampler = String::new();
        let mut scheduler = String::new();

        if let Some(s) = self.evaluate_string(node, "sampler_name") { sampler = s; }
        if let Some(s) = self.evaluate_string(node, "scheduler") { scheduler = s; }

        // 3. Complex Mapping (Flux/SD3 SamplerCustomAdvanced)
        // If parameters are missing, they might be in separated nodes (Sigmas, Guider, Sampler)
        if meta.steps == 0 || sampler.is_empty() {
             // Trace Sigmas -> BasicScheduler (steps, scheduler)
             if let Some(sigmas_id) = self.get_source_id(node, "sigmas") {
                 if let Some(sigmas_node) = self.graph.get_node(&sigmas_id) {
                     if let Some(v) = self.evaluate_number(sigmas_node, "steps", 500) { meta.steps = v as u32; }
                     if let Some(s) = self.evaluate_string(sigmas_node, "scheduler") { scheduler = s; }
                 }
             }
             // Trace Sampler -> KSamplerSelect (sampler_name)
             if let Some(samp_id) = self.get_source_id(node, "sampler") {
                 if let Some(samp_node) = self.graph.get_node(&samp_id) {
                     if let Some(s) = self.evaluate_string(samp_node, "sampler_name") { sampler = s; }
                 }
             }
        }

        if !sampler.is_empty() {
             meta.sampler = if !scheduler.is_empty() {
                 format!("{} ({})", sampler, scheduler)
             } else {
                 sampler
             };
        }

        // 4. Model (Recursive with Lora collection)
        if let Some(model_name) = self.trace_model_chain(node, "model", &mut meta.loras) {
            meta.model = model_name.replace(".safetensors", "").replace(".ckpt", "");
        } else if let Some(guider_id) = self.get_source_id(node, "guider") {
            // Flux Guider logic
            if let Some(guider_node) = self.graph.get_node(&guider_id) {
                if let Some(model_name) = self.trace_model_chain(guider_node, "model", &mut meta.loras) {
                    meta.model = model_name.replace(".safetensors", "").replace(".ckpt", "");
                }
            }
        }

        // 5. Prompts (Recursive with ControlNet collection)
        // Standard inputs
        if let Some(pos) = self.trace_conditioning_chain(node, "positive", "positive", &mut meta.control_nets) {
            meta.positive_prompt = pos;
        }
        if let Some(neg) = self.trace_conditioning_chain(node, "negative", "negative", &mut meta.control_nets) {
            meta.negative_prompt = neg;
        }
        // Flux Guider inputs
         if meta.positive_prompt.is_empty() {
             if let Some(guider_id) = self.get_source_id(node, "guider") {
                 if let Some(guider_node) = self.graph.get_node(&guider_id) {
                     if let Some(pos) = self.trace_conditioning_chain(guider_node, "conditioning", "positive", &mut meta.control_nets) {
                         meta.positive_prompt = pos;
                     }
                 }
             }
         }

        meta
    }
    
    // --- Tracing Logic ---

    fn get_source_id(&self, node: &Value, input_name: &str) -> Option<String> {
        // 1. Direct Link
        if let Some(link) = get_node_input_link(node, input_name) {
            // Handle Reroutes and Bypassed nodes instantly here to flatten the graph
            return self.resolve_link(link);
        }
        
        // 2. Wireless Fallback (Heuristics)
        // If no link exists, try to find a Wireless Broadcaster
        if let Some(wireless_id) = find_wireless_node(self.graph, node, input_name) {
             return Some(wireless_id);
        }

        None
    }

    /// Recursively resolves simple pass-through nodes (Reroute, Bypassed nodes)
    fn resolve_link(&self, node_id: String) -> Option<String> {
        let mut current_id = node_id;
        let mut depth = 0;
        
        while depth < 20 {
            let node = self.graph.get_node(&current_id)?;
            let t = get_node_type(node);
            
            if t == "Reroute" || t == "Node Reroute" || self.is_bypassed(node) {
                // Find the first input and follow it
                // Reroutes usually have input named "0" or just one input
                if let Some(input_val) = node.get("inputs") {
                    if let Some(obj) = input_val.as_object() {
                        // Just take the first valid link
                        // NOTE: Bypassed nodes pass input index 0 to output index 0 usually.
                        // Simplification: We take the first input we can find.
                        if let Some((_, val)) = obj.iter().next() {
                             // Parse link format (Array [link_id, slot] or String/Number)
                             // Warning: This depends on graph.rs normalization from 'formatted'
                             // graph.rs `get_node_input_link` logic needs to be robust. 
                             // We'll trust `get_source_id` logic recursively if we call it safely.
                             
                             // A bypassed node might have "model", "positive", etc.
                             // We need to know WHICH input maps to the output we are tracing.
                             // For simplicity: Reroutes have 1 input.
                             // Bypassed nodes: We assume the input corresponding to the output type matches. 
                             // This is hard to guess without slot mapping. 
                             // Let's assume input 0 for now.
                             
                             // Let's rely on internal resolved inputs if standard helpers fail.
                             // For now, let's just return the IDs of Reroute nodes and let the *Caller* handle specific logic?
                             // No, best to flatten.
                             
                             // Let's try to get ANY input link
                             if let Some(link) = self.get_any_input_link(node) {
                                 current_id = link;
                                 depth += 1;
                                 continue;
                             }
                        }
                    }
                }
                return None; // Dead end reroute
            }
            return Some(current_id);
        }
        None
    }
    
    fn get_any_input_link(&self, node: &Value) -> Option<String> {
        if let Some(inputs) = node.get("inputs").and_then(|v| v.as_object()) {
             for (_k, v) in inputs {
                 // Check if it looks like a link
                 if let Some(arr) = v.as_array() {
                     if !arr.is_empty() {
                         // API Format link usually [link_id, slot] -> graph.rs resolves to node_id
                         // Wait, ComfyGraph normalizes this to just node_id string in `_resolved_inputs`
                         // or we use `get_node_input_link` helper.
                         // Let's inspect `graph.rs` helper usage.
                         // Actually, `get_node_input_link` handles the lookup.
                         // We need to iterate KEYS.
                     }
                 }
                 // In normalized graph, we might have `_resolved_inputs`. 
                 // But let's check keys.
             }
             // Fallback: check all keys using `get_node_input_link`
             for key in inputs.keys() {
                 if let Some(link) = get_node_input_link(node, key) {
                     return Some(link);
                 }
             }
        }
        None
    }

    // --- Trace Chains ---

    fn trace_model_chain(&self, start_node: &Value, input_name: &str, loras: &mut Vec<String>) -> Option<String> {
        let mut current_id = self.get_source_id(start_node, input_name)?;
        
        for _ in 0..20 {
             let node = self.graph.get_node(&current_id)?;
             let t = get_node_type(node);

             if t == "LoraLoader" || t == "LoraLoaderModelOnly" {
                 // Extract Lora
                 if let Some(name) = get_node_param(node, "lora_name").and_then(|v| v.as_str()) {
                     let name = name.replace(".safetensors", "").replace(".ckpt", "");
                     let strength = get_node_param(node, "strength_model").and_then(|v| v.as_f64()).unwrap_or(1.0);
                     let entry = if (strength - 1.0).abs() > 0.001 { format!("{} ({:.2})", name, strength) } else { name };
                     if !loras.contains(&entry) { loras.push(entry); }
                 }
                 // Continue up "model" input
                 if let Some(next) = self.get_source_id(node, "model") {
                     current_id = next;
                     continue;
                 }
                 break;
             }
             else if t == "Lora Loader (LoraManager)" {
                 // Custom Lora Manager
                 self.extract_lora_manager(node, loras);
                 if let Some(next) = self.get_source_id(node, "model") {
                     current_id = next;
                     continue;
                 }
                 break; 
             }
             else if get_node_type(node).contains("CheckpointLoader") || get_node_type(node).contains("UNETLoader") || get_node_type(node).contains("Ckpt Loader") || get_node_type(node).contains("EasyLoader") {
                 // Check if it's a passthrough (linked input)
                 if let Some(next) = self.get_source_id(node, "ckpt_name") { current_id = next; continue; }
                 if let Some(next) = self.get_source_id(node, "unet_name") { current_id = next; continue; }
                 if let Some(next) = self.get_source_id(node, "checkpoint") { current_id = next; continue; }

                 // Found it!
                 let mut name = String::new();
                 if let Some(n) = get_node_param(node, "ckpt_name").and_then(|v| v.as_str()) { name = n.to_string(); }
                 else if let Some(n) = get_node_param(node, "unet_name").and_then(|v| v.as_str()) { name = n.to_string(); }
                 else if let Some(n) = get_node_param(node, "checkpoint").and_then(|v| v.as_str()) { name = n.to_string(); }
                 
                 return Some(name.replace(".safetensors", "").replace(".ckpt", ""));
             }
             
             // Pass through generic nodes (ApplyFBCache, FreeU, etc) which modify model but aren't origin
             if let Some(next) = self.get_source_id(node, "model") {
                 current_id = next;
                 continue;
             }
             
             break;
        }
        None
    }
    
    fn extract_lora_manager(&self, node: &Value, loras: &mut Vec<String>) {
         if let Some(loras_obj) = node.get("inputs").and_then(|v| v.get("loras")) {
             // Handle custom object structure if present
             if let Some(values) = loras_obj.get("__value__").and_then(|v| v.as_array()) {
                 for lora in values {
                     if let Some(name) = lora.get("name").and_then(|v| v.as_str()) {
                         let name = name.replace(".safetensors", "").replace(".ckpt", "");
                         let strength = lora.get("strength").and_then(|v| v.as_f64()).unwrap_or(1.0);
                         let active = lora.get("active").and_then(|v| v.as_bool()).unwrap_or(true);
                         if active {
                             let entry = if (strength - 1.0).abs() > 0.001 { format!("{} ({:.2})", name, strength) } else { name };
                             if !loras.contains(&entry) { loras.push(entry); }
                         }
                     }
                 }
             }
         }
    }

    fn trace_conditioning_chain(&self, start_node: &Value, input_name: &str, branch: &str, control_nets: &mut Vec<String>) -> Option<String> {
        let mut current_id = self.get_source_id(start_node, input_name)?;
        
        for _ in 0..20 {
             let node = self.graph.get_node(&current_id)?;
             let t = get_node_type(node);

             if t == "ControlNetApply" || t == "ControlNetApplyAdvanced" {
                 // Extract ControlNet
                 if let Some(cn_id) = self.get_source_id(node, "control_net") {
                     if let Some(cn_node) = self.graph.get_node(&cn_id) {
                         // ControlNetLoader -> control_net_name
                         if let Some(name) = get_node_param(cn_node, "control_net_name").and_then(|v| v.as_str()) {
                              let name = name.replace(".safetensors", "").replace(".pth", "");
                              if !control_nets.contains(&name) { control_nets.push(name); }
                         }
                     }
                 }
                 // Continue up "conditioning"
                 if let Some(next) = self.get_source_id(node, "conditioning") {
                     current_id = next;
                     continue;
                 }
                 break;
             }
             else if t == "CLIPTextEncode" || t == "CLIPTextEncodeSDXL" || t.contains("CLIPTextEncode") {
                 // Found Prompt!
                 return self.trace_text(node, "text");
             }
             else if t == "ConditioningCombine" || t == "ConditioningAverage" {
                 // For arrays/combos, just take the first one for now or text trace both?
                 // Let's trace input "conditioning_1"
                  if let Some(next) = self.get_source_id(node, "conditioning_1") {
                     current_id = next;
                     continue;
                 }
             }
             
             // Pass through (Generic + Branch aware)
             if let Some(next) = self.get_source_id(node, "conditioning") {
                 current_id = next;
                 continue;
             }
             // Try branch specific input (e.g. "positive" for InpaintModelConditioning)
             if let Some(next) = self.get_source_id(node, branch) {
                 current_id = next;
                 continue;
             }
             
             break;
        }
        None
    }
    
    // Evaluate text using simulation for primitives/concatenation
    fn trace_text(&self, node: &Value, input_name: &str) -> Option<String> {
        // 1. Check direct string widget
        if let Some(val) = get_node_param(node, input_name) {
            if let Some(s) = val.as_str() {
                return Some(s.to_string());
            }
        }
        
        // 2. Trace upstream string logic
        if let Some(source_id) = self.get_source_id(node, input_name) {
             return self.evaluate_string_node(&source_id, 0);
        }
        
        None
    }
    
    fn evaluate_string_node(&self, node_id: &str, depth: u32) -> Option<String> {
        if depth > 10 { return None; }
        let node = self.graph.get_node(node_id)?;
        let t = get_node_type(node);
        
        if t == "String" || t == "PrimitiveNode" || t.contains("StringLiteral") || t == "PrimitiveStringMultiline" || t == "PrimitiveString" {
             if let Some(v) = get_node_param(node, "value") { 
                 if let Some(s) = v.as_str() { return Some(s.to_string()); }
                 // Check if it's a link?
                 // But Primitive nodes usually have 'value' as widget.
                 // If it is a link, get_node_param returns the link array. contextually we don't know it's a link here easily without `get_node_input_link` on the key.
             }
             // Actually, generic evaluate_string handles source_id lookup.
             // But evaluating a "Primitive" node usually means reading its widget value.
             // If a Primitive has an Input, it's weird.
             // Let's rely on standard widget extraction which evaluate_string does NOT do?
             // evaluate_string calls get_node_param.
             
             // Let's improve this block:
             if let Some(s) = self.evaluate_string(node, "value") { return Some(s); }
             if let Some(s) = self.evaluate_string(node, "string") { return Some(s); }
             if let Some(s) = self.evaluate_string(node, "String") { return Some(s); }
             // Primitives often use widgets_values[0]
             if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
                 if let Some(s) = arr.get(0).and_then(|v| v.as_str()) { return Some(s.to_string()); }
             }
        }
        else if t == "JoinStringMulti" || t == "String Concatenate" {
            // Collect all inputs starting with "string_" or "text_"
            // Rough simulation
            let mut parts = Vec::new();
            if let Some(inputs) = node.get("inputs").and_then(|v| v.as_object()) {
                // We need to sort keys to maintain order? Comfy inputs usually unordered in API JSON, 
                // but keys like "string_1", "string_2" etc imply order.
                let mut keys: Vec<&String> = inputs.keys().collect();
                keys.sort();
                
                for key in keys {
                    if key.starts_with("string_") || key.starts_with("text_") {
                         if let Some(s) = self.evaluate_string(node, key) {
                             parts.push(s);
                         }
                    }
                }
            }
            let delimiter = get_node_param(node, "delimiter").and_then(|v| v.as_str()).unwrap_or("");
            return Some(parts.join(delimiter));
        }
        else if t == "ShowText" || t.contains("ShowAnything") || t == "Text Box" || t.contains("TextEncode") {
             if let Some(s) = self.evaluate_string(node, "text") { return Some(s); }
             if let Some(s) = self.evaluate_string(node, "anything") { return Some(s); }
             return None;
        }
        else if t == "Remove Text" {
             return self.trace_text(node, "Text");
        }
        else if t.contains("OllamaGenerate") {
             // Index 1 is usually the User Prompt in Ollama nodes. 
             // Default get_node_param might return Index 0 (System Prompt).
             if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
                 if let Some(s) = arr.get(1).and_then(|v| v.as_str()) { return Some(s.to_string()); }
             }
             if let Some(s) = self.evaluate_string(node, "prompt") { return Some(s); }
             return None;
        }
        else {
             // Generic fallback: check common string holding parameters
             if let Some(v) = get_node_param(node, "text").and_then(|v| v.as_str()) { return Some(v.to_string()); }
             if let Some(v) = get_node_param(node, "string").and_then(|v| v.as_str()) { return Some(v.to_string()); }
             if let Some(v) = get_node_param(node, "String").and_then(|v| v.as_str()) { return Some(v.to_string()); }
             if let Some(v) = get_node_param(node, "populated_text").and_then(|v| v.as_str()) { return Some(v.to_string()); }
             if let Some(v) = get_node_param(node, "trigger_words").and_then(|v| v.as_str()) { return Some(v.to_string()); }
        }
        
        None
    }

    // --- Helpers ---
    
    fn evaluate_number(&self, node: &Value, param: &str, max_limit: i64) -> Option<i64> {
        if let Some(val) = get_node_param(node, param) {
            if let Some(i) = val.as_i64() {
                if i < max_limit { return Some(i); }
            }
            if let Some(u) = val.as_u64() {
                if u < (max_limit as u64) { return Some(u as i64); }
            }
        }
        // Try Input Link (e.g., Primitive connected to 'steps')
        if let Some(source_id) = self.get_source_id(node, param) {
             let source = self.graph.get_node(&source_id)?;
             // Recursively get value from Primitive/Int node
             if let Some(v) = get_node_param(source, "value").and_then(|v| v.as_i64()) { return Some(v); }
             if let Some(v) = get_node_param(source, "int").and_then(|v| v.as_i64()) { return Some(v); }
             // Check if source has the same param (e.g. steps -> steps)
             if let Some(v) = get_node_param(source, param).and_then(|v| v.as_i64()) { return Some(v); }
             // widget value
             if let Some(arr) = source.get("widgets_values").and_then(|v| v.as_array()) {
                 if let Some(v) = arr.get(0).and_then(|v| v.as_i64()) { return Some(v); }
             }
        }
        None
    }
    
    fn evaluate_float(&self, node: &Value, param: &str, max_limit: f64) -> Option<f64> {
        if let Some(val) = get_node_param(node, param) {
            if let Some(f) = val.as_f64() {
                if f < max_limit { return Some(f); }
            }
        }
        if let Some(source_id) = self.get_source_id(node, param) {
             let source = self.graph.get_node(&source_id)?;
             if let Some(v) = get_node_param(source, "value").and_then(|v| v.as_f64()) { return Some(v); }
             if let Some(v) = get_node_param(source, "float").and_then(|v| v.as_f64()) { return Some(v); }
             // Check if source has the same param
             if let Some(v) = get_node_param(source, param).and_then(|v| v.as_f64()) { return Some(v); }
             if let Some(arr) = source.get("widgets_values").and_then(|v| v.as_array()) {
                 if let Some(v) = arr.get(0).and_then(|v| v.as_f64()) { return Some(v); }
             }
        }
        None
    }
    
    fn evaluate_string(&self, node: &Value, param: &str) -> Option<String> {
        if let Some(val) = get_node_param(node, param) {
            if let Some(s) = val.as_str() { return Some(s.to_string()); }
        }
        if let Some(source_id) = self.get_source_id(node, param) {
            return self.evaluate_string_node(&source_id, 0);
        }
        None
    }
}
