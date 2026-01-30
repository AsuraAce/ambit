use super::graph::{get_node_input_link, get_node_param, get_node_type, ComfyGraph};

use super::conditioning::find_reachable_prompts;
use super::heuristics::find_wireless_node;
use crate::metadata::utils::{extract_embeddings_from_prompt, extract_loras_from_prompt, extract_hypernets_from_prompt};
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

    pub fn _split_sampler_scheduler(sampler_field: &str) -> (Option<String>, Option<String>) {
        if let Some((samp, sched)) = sampler_field.split_once(' ') {
            // Check if second part looks like a scheduler
            let common_schedulers = [
                "normal",
                "karras",
                "exponential",
                "sgm_uniform",
                "simple",
                "ddim_uniform",
                "beta",
            ];
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
                        let partial = self.extract_from_sampler(&root_sampler_id, root_node);
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
            if (t.contains("KSampler") && !t.contains("Select") && !t.contains("Provider"))
                || t == "SamplerCustomAdvanced"
            {
                // We found a sampler. Extract from it.
                // We might want to prioritize "active" ones (not muted)?
                if !self.is_muted(node) {
                    let partial = self.extract_from_sampler(id, node);
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
            if t == "SaveImage"
                || t == "PreviewImage"
                || t == "ImageSave"
                || t == "SDPromptSaver"
                || t.contains("SaveImage")
            {
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
        if depth > 50 {
            return None;
        }

        let node = self.graph.get_node(start_id)?;

        // Is this node a sampler?
        let t = get_node_type(node);
        if t.contains("KSampler")
            || t == "SamplerCustomAdvanced"
            || t == "SamplerCustom"
            || t.contains("StyleAlignedReferenceSampler")
        {
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
                        if t.contains("KSampler")
                            || t == "SamplerCustomAdvanced"
                            || t == "SamplerCustom"
                            || t.contains("StyleAlignedReferenceSampler")
                        {
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
    fn extract_from_sampler(&self, node_id: &str, node: &Value) -> ImageMetadata {
        let mut meta = ImageMetadata::default();

        // 1. Direct Parameters (Steps, CFG, Seed)
        if let Some(v) = self.evaluate_number(node, "steps", 500) {
            meta.steps = v as u32;
        }
        if let Some(v) = self.evaluate_float(node, "cfg", 200.0) {
            meta.cfg = v as f32;
        }
        if let Some(v) = self.evaluate_number(node, "seed", i64::MAX) {
            meta.seed = v;
        } else if let Some(v) = self.evaluate_number(node, "noise_seed", i64::MAX) {
            meta.seed = v;
        }

        // 2. Sampler Name / Scheduler
        let mut sampler = String::new();
        let mut scheduler = String::new();

        if let Some(s) = self.evaluate_string(node, "sampler_name") {
            sampler = s;
        }
        if let Some(s) = self.evaluate_string(node, "scheduler") {
            scheduler = s;
        }

        // 3. Complex Mapping (Flux/SD3 SamplerCustomAdvanced)
        // If parameters are missing, they might be in separated nodes (Sigmas, Guider, Sampler)
        if meta.steps == 0 || sampler.is_empty() {
            // Trace Sigmas -> BasicScheduler (steps, scheduler)
            if let Some(sigmas_id) = self.get_source_id(node, "sigmas") {
                if let Some(sigmas_node) = self.graph.get_node(&sigmas_id) {
                    if let Some(v) = self.evaluate_number(sigmas_node, "steps", 500) {
                        meta.steps = v as u32;
                    }
                    if let Some(s) = self.evaluate_string(sigmas_node, "scheduler") {
                        scheduler = s;
                    }
                }
            }
            // Trace Sampler -> KSamplerSelect (sampler_name)
            if let Some(samp_id) = self.get_source_id(node, "sampler") {
                if let Some(samp_node) = self.graph.get_node(&samp_id) {
                    if let Some(s) = self.evaluate_string(samp_node, "sampler_name") {
                        sampler = s;
                    }
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
        if let Some(model_name) = self.trace_model_chain(node, "model", &mut meta.loras, &mut meta.ip_adapters) {
            meta.model = model_name;
        } else if let Some(guider_id) = self.get_source_id(node, "guider") {
            // Flux Guider logic
            if let Some(guider_node) = self.graph.get_node(&guider_id) {
                if let Some(model_name) =
                    self.trace_model_chain(guider_node, "model", &mut meta.loras, &mut meta.ip_adapters)
                {
                    meta.model = model_name;
                }
            }
        }

        // 5. Prompts (Recursive with ControlNet collection)
        // Standard inputs
        // 5. Prompts (Recursive Reachability Search)
        // Standard inputs
        let pos = find_reachable_prompts(self.graph, node_id, "positive");
        if !pos.is_empty() {
            meta.positive_prompt = pos;
        }

        let neg = find_reachable_prompts(self.graph, node_id, "negative");
        if !neg.is_empty() {
            meta.negative_prompt = neg;
        }

        // 5.1 Extract Resources from Prompts
        for emb in extract_embeddings_from_prompt(&meta.positive_prompt) {
            if !meta.embeddings.contains(&emb) {
                meta.embeddings.push(emb);
            }
        }
        for emb in extract_embeddings_from_prompt(&meta.negative_prompt) {
            if !meta.embeddings.contains(&emb) {
                meta.embeddings.push(emb);
            }
        }

        for lora in extract_loras_from_prompt(&meta.positive_prompt) {
            if !meta.loras.contains(&lora) {
                meta.loras.push(lora);
            }
        }
        for lora in extract_loras_from_prompt(&meta.negative_prompt) {
            if !meta.loras.contains(&lora) {
                meta.loras.push(lora);
            }
        }

        for hn in extract_hypernets_from_prompt(&meta.positive_prompt) {
            if !meta.hypernetworks.contains(&hn) {
                meta.hypernetworks.push(hn);
            }
        }
        for hn in extract_hypernets_from_prompt(&meta.negative_prompt) {
            if !meta.hypernetworks.contains(&hn) {
                meta.hypernetworks.push(hn);
            }
        }

        // Flux Guider inputs
        if meta.positive_prompt.is_empty() {
            if let Some(guider_id) = self.get_source_id(node, "guider") {
                let pos_guider = find_reachable_prompts(self.graph, &guider_id, "conditioning");
                if !pos_guider.is_empty() {
                    meta.positive_prompt = pos_guider;
                }
            }
        }
        
        // 6. ControlNets
        use super::conditioning::find_connected_controlnets;
        let cnets = find_connected_controlnets(self.graph, node_id, "positive", &mut meta.ip_adapters);
        for cn in cnets {
            if !meta.control_nets.contains(&cn) {
                meta.control_nets.push(cn);
            }
        }
        
        // 7. Filter IP-Adapter from LoRAs (User incorrectly identifies them as LoRAs)
        // We will move them to 'control_nets' IF they aren't already there strings?
        // Or just leave them but maybe in the future we use a separate field.
        // For now, if the user says "IP Adapter is not a LoRA", they probably don't want to see it in the LoRA list.
        // But since it IS implemented as a LoRA file, filtering it might hide it completely.
        // Let's keep it for now but ensure CNs are present.
        
        // Actually, if we have IPAdapter in LoRAs, let's keep it. 
        // The user's workflow uses a LoRA loader for the IPAdapter model. It IS a LoRA.
        
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
                        if obj.values().next().is_some() {
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

    fn trace_model_chain(
        &self,
        start_node: &Value,
        input_name: &str,
        loras: &mut Vec<String>,
        ip_adapters: &mut Vec<String>,
    ) -> Option<String> {
        let mut current_id = self.get_source_id(start_node, input_name)?;

        for _ in 0..20 {
            let node = self.graph.get_node(&current_id)?;
            let t = get_node_type(node);

            if t == "LoraLoader" || t == "LoraLoaderModelOnly" {
                // ... (Lora logic remains same)
                if let Some(name) = get_node_param(node, "lora_name").and_then(|v| v.as_str()) {
                    let name = crate::metadata::guidance::GuidanceClassifier::clean_name(name);
                    if !loras.contains(&name) {
                        loras.push(name);
                    }
                }
                // ...
                if let Some(next) = self.get_source_id(node, "model") {
                    current_id = next;
                    continue;
                }
                break;
            } else if t == "Lora Loader (LoraManager)" {
                 // ...
                self.extract_lora_manager(node, loras);
                if let Some(next) = self.get_source_id(node, "model") {
                    current_id = next;
                    continue;
                }
                break;
            } else if get_node_type(node).contains("CheckpointLoader")
                || get_node_type(node).contains("UNETLoader")
                || get_node_type(node).contains("Ckpt Loader")
                || get_node_type(node).contains("EasyLoader")
            {
                // ... (Checkpoint logic remains same)
                if let Some(next) = self.get_source_id(node, "ckpt_name") {
                    current_id = next;
                    continue;
                }
                if let Some(next) = self.get_source_id(node, "unet_name") {
                    current_id = next;
                    continue;
                }
                if let Some(next) = self.get_source_id(node, "checkpoint") {
                    current_id = next;
                    continue;
                }

                // Found it!
                let mut name = String::new();
                if let Some(n) = get_node_param(node, "ckpt_name").and_then(|v| v.as_str()) {
                    name = n.to_string();
                } else if let Some(n) = get_node_param(node, "unet_name").and_then(|v| v.as_str()) {
                    name = n.to_string();
                } else if let Some(n) = get_node_param(node, "checkpoint").and_then(|v| v.as_str())
                {
                    name = n.to_string();
                }

                if !name.is_empty() && name != "None" {
                    return Some(crate::metadata::guidance::GuidanceClassifier::clean_name(&name));
                }
            } else if get_node_type(node) == "SDParameterGenerator" {
                if let Some(n) = get_node_param(node, "ckpt_name").and_then(|v| v.as_str()) {
                    if n != "None" {
                        return Some(crate::metadata::guidance::GuidanceClassifier::clean_name(n));
                    }
                }
            }

            // Check for side-loaded IP Adapters (treated as separate category)
            // IPAdapterApply nodes modify the model. We check their 'ipadapter' input.
            if get_node_type(node).contains("IPAdapterApply") {
                 if let Some(ip_source) = self.get_source_id(node, "ipadapter") {
                     if let Some(ip_node) = self.graph.get_node(&ip_source) {
                         // Check if it's the loader
                         if get_node_type(ip_node).contains("IPAdapterModelLoader") {
                             if let Some(name) = get_node_param(ip_node, "ipadapter_file").and_then(|v| v.as_str()) {
                                 let name = crate::metadata::guidance::GuidanceClassifier::clean_name(name);
                                 
                                 // IPAdapter usually implies weight, but it's on the Apply node.
                                 if !ip_adapters.contains(&name) {
                                     ip_adapters.push(name);
                                 }
                             }
                         }
                     }
                 }
            }

            // Pass through generic nodes (ApplyFBCache, FreeU, etc) which modify model but aren't origin
            let model_inputs = ["model", "ckpt", "base_model"];
            let mut found_next = false;
            for input_key in model_inputs {
                if let Some(next) = self.get_source_id(node, input_key) {
                    current_id = next;
                    found_next = true;
                    break;
                }
            }

            if found_next {
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
                        let active = lora.get("active").and_then(|v| v.as_bool()).unwrap_or(true);
                        if active {
                            let cleaned_name = crate::metadata::guidance::GuidanceClassifier::clean_name(name);
                            let strength = if let Some(s) = lora.get("strength") {
                                if let Some(f) = s.as_f64() {
                                    Some(f)
                                } else if let Some(s_str) = s.as_str() {
                                    s_str.parse::<f64>().ok()
                                } else {
                                    None
                                }
                            } else {
                                None
                            };

                            let entry = if let Some(s) = strength {
                                if (s - 1.0).abs() > 0.001 {
                                    format!("{} ({:.2})", cleaned_name, s)
                                } else {
                                    cleaned_name
                                }
                            } else {
                                cleaned_name
                            };

                            if !loras.contains(&entry) {
                                loras.push(entry);
                            }
                        }
                    }
                }
            }
        }
    }

    // --- Helpers ---

    fn evaluate_number(&self, node: &Value, param: &str, max_limit: i64) -> Option<i64> {
        if let Some(val) = get_node_param(node, param) {
            if let Some(i) = val.as_i64() {
                if i < max_limit {
                    return Some(i);
                }
            }
            if let Some(u) = val.as_u64() {
                if u < (max_limit as u64) {
                    return Some(u as i64);
                }
            }
        }
        // Try Input Link (e.g., Primitive connected to 'steps')
        if let Some(source_id) = self.get_source_id(node, param) {
            let source = self.graph.get_node(&source_id)?;
            // Recursively get value from Primitive/Int node
            if let Some(v) = get_node_param(source, "value").and_then(|v| v.as_i64()) {
                return Some(v);
            }
            if let Some(v) = get_node_param(source, "int").and_then(|v| v.as_i64()) {
                return Some(v);
            }
            // Check if source has the same param (e.g. steps -> steps)
            if let Some(v) = get_node_param(source, param).and_then(|v| v.as_i64()) {
                return Some(v);
            }
            // widget value
            if let Some(arr) = source.get("widgets_values").and_then(|v| v.as_array()) {
                if let Some(v) = arr.get(0).and_then(|v| v.as_i64()) {
                    return Some(v);
                }
            }
        }
        None
    }

    fn evaluate_float(&self, node: &Value, param: &str, max_limit: f64) -> Option<f64> {
        if let Some(val) = get_node_param(node, param) {
            if let Some(f) = val.as_f64() {
                if f < max_limit {
                    return Some(f);
                }
            }
        }
        if let Some(source_id) = self.get_source_id(node, param) {
            let source = self.graph.get_node(&source_id)?;
            if let Some(v) = get_node_param(source, "value").and_then(|v| v.as_f64()) {
                return Some(v);
            }
            if let Some(v) = get_node_param(source, "float").and_then(|v| v.as_f64()) {
                return Some(v);
            }
            // Check if source has the same param
            if let Some(v) = get_node_param(source, param).and_then(|v| v.as_f64()) {
                return Some(v);
            }
            if let Some(arr) = source.get("widgets_values").and_then(|v| v.as_array()) {
                if let Some(v) = arr.get(0).and_then(|v| v.as_f64()) {
                    return Some(v);
                }
            }
        }
        None
    }

    fn evaluate_string(&self, node: &Value, param: &str) -> Option<String> {
        if let Some(val) = get_node_param(node, param) {
            if let Some(s) = val.as_str() {
                return Some(s.to_string());
            }
        }
        if let Some(source_id) = self.get_source_id(node, param) {
            return super::conditioning::evaluate_string_node(self.graph, &source_id, 0);
        }
        None
    }
}
