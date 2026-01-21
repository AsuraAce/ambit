use super::ImageMetadata;
use std::collections::HashMap;

mod graph;
mod traversal;

#[cfg(test)]
mod tests;

use self::graph::{ComfyGraph, get_node_type, is_output_node, get_node_input_link, is_model_loader, get_node_param, get_node_title};
use self::traversal::{find_sampler_upstream, trace_node_param, extract_model_from_node, trace_text_source, trace_model_source};

pub fn extract_comfyui_metadata(chunks: &HashMap<String, String>) -> ImageMetadata {
    // Breadcrumb for ComfyUI parsing
    // Note: We don't have the filename here easily unless we pass it down, 
    // but confirming we ENTERED this function is useful.
    // We can assume it corresponds to the last "Starting" log.
    println!("[ComfyUI] Parsing metadata...");
    
    let mut meta = ImageMetadata::default();
    meta.tool = "ComfyUI".to_string();

    if let Some(workflow) = chunks.get("workflow") {
        meta.workflow_json = Some(workflow.clone());
    } else if let Some(prompt) = chunks.get("prompt") {
        meta.workflow_json = Some(prompt.clone());
    }

    // ComfyUI has two formats: 
    // 1. "prompt" chunk (API format): Flat object { "id": { "class_type": "...", "inputs": {...} } }
    // 2. "workflow" chunk (UI format): Object { "nodes": [{ "type": "...", "widgets_values": [...] }] }
    
    // Normalize graph
    let graph = ComfyGraph::from_chunks(chunks);
    let nodes_map = &graph.nodes;

    if nodes_map.is_empty() {
        return meta;
    }
    
    // 1. Find the "active" KSampler node
    let mut ksampler_id = "".to_string();
    
    // First pass: find a sampler linked to an output node
    for (id, node) in nodes_map {
        let class_type = get_node_type(node);
        if is_output_node(class_type) {
            if let Some(sampler_id) = find_sampler_upstream(nodes_map, id) {
                ksampler_id = sampler_id;
                break;
            }
        }
    }

    // Second pass: fallback to any KSampler
    if ksampler_id.is_empty() {
        for (id, node) in nodes_map {
            if get_node_type(node).to_lowercase().contains("ksampler") {
                ksampler_id = id.clone();
                break;
            }
        }
    }

    if !ksampler_id.is_empty() {
        let ksampler_node = nodes_map.get(&ksampler_id).unwrap();
        
        // Extract direct KSampler properties with tracing
        if let Some(seed) = trace_node_param(nodes_map, ksampler_node, "seed", 0).and_then(|v| v.as_i64()) {
            meta.seed = seed;
        } else if let Some(seed) = trace_node_param(nodes_map, ksampler_node, "noise_seed", 0).and_then(|v| v.as_i64()) {
            meta.seed = seed;
        }

        if let Some(steps) = trace_node_param(nodes_map, ksampler_node, "steps", 0).and_then(|v| v.as_u64()) {
            meta.steps = steps as u32;
        }

        if let Some(cfg) = trace_node_param(nodes_map, ksampler_node, "cfg", 0).and_then(|v| v.as_f64()) {
            meta.cfg = cfg as f32;
        }

        if let Some(sampler) = trace_node_param(nodes_map, ksampler_node, "sampler_name", 0).and_then(|s| s.as_str()) {
            meta.sampler = sampler.to_string();
            if let Some(scheduler) = trace_node_param(nodes_map, ksampler_node, "scheduler", 0).and_then(|s| s.as_str()) {
                meta.sampler = format!("{} ({})", meta.sampler, scheduler);
            }
        }

        // Traverse for Model
        if let Some(model_id) = get_node_input_link(ksampler_node, "model") {
            if let Some(model_name) = trace_model_source(nodes_map, &model_id) {
                meta.model = model_name;
            }
        }

        // Traverse for Prompts
        if let Some(pos_id) = get_node_input_link(ksampler_node, "positive") {
            if let Some(text) = trace_text_source(nodes_map, &pos_id) {
                meta.positive_prompt = text;
            }
        }
        if let Some(neg_id) = get_node_input_link(ksampler_node, "negative") {
            if let Some(text) = trace_text_source(nodes_map, &neg_id) {
                meta.negative_prompt = text;
            }
        }
    }

    // ---------------------------------------------------------
    // Handling for SamplerCustomAdvanced (Flux / SD3)
    // ---------------------------------------------------------
    if ksampler_id.is_empty() || meta.steps == 0 {
        for (_id, node) in nodes_map {
            let class_type = get_node_type(node);
            if class_type == "SamplerCustomAdvanced" {
                // This is likely a Flux or SD3 workflow using separated components
                // Inputs: noise, guider, sampler, sigmas, latent_image

                // 1. Trace Guider -> Model
                if meta.model == "Unknown" || meta.model.is_empty() {
                    if let Some(guider_id) = get_node_input_link(node, "guider") {
                         if let Some(guider_node) = nodes_map.get(&guider_id) {
                              // BasicGuider -> input "model"
                              if let Some(model_id) = get_node_input_link(guider_node, "model") {
                                  if let Some(name) = trace_model_source(nodes_map, &model_id) {
                                      meta.model = name;
                                  }
                              }
                         }
                    }
                }

                // 2. Trace Sigmas -> Steps / Scheduler
                if meta.steps == 0 {
                    if let Some(sigmas_id) = get_node_input_link(node, "sigmas") {
                        if let Some(sigmas_node) = nodes_map.get(&sigmas_id) {
                            // BasicScheduler -> steps, scheduler, denoise
                            if let Some(steps) = trace_node_param(nodes_map, sigmas_node, "steps", 0).and_then(|v| v.as_u64()) {
                                meta.steps = steps as u32;
                            }
                            // Sometimes scheduler is here
                             if let Some(_scheduler) = trace_node_param(nodes_map, sigmas_node, "scheduler", 0).and_then(|v| v.as_str()) {
                                 // We'll append this to sampler later if found
                             }
                        }
                    }
                }

                // 3. Trace Sampler -> Sampler Name
                {
                    let mut sampler_name = String::new();
                    let mut scheduler_name = String::new();

                    if let Some(sampler_id) = get_node_input_link(node, "sampler") {
                        if let Some(sampler_node) = nodes_map.get(&sampler_id) {
                             if let Some(name) = trace_node_param(nodes_map, sampler_node, "sampler_name", 0).and_then(|v| v.as_str()) {
                                 sampler_name = name.to_string();
                             }
                        }
                    }
                    
                    // Try to find scheduler from sigmas
                    if let Some(sigmas_id) = get_node_input_link(node, "sigmas") {
                        if let Some(sigmas_node) = nodes_map.get(&sigmas_id) {
                             if let Some(sch) = trace_node_param(nodes_map, sigmas_node, "scheduler", 0).and_then(|v| v.as_str()) {
                                 scheduler_name = sch.to_string();
                             }
                        }
                    }

                    if !sampler_name.is_empty() {
                        let full_name = if !scheduler_name.is_empty() {
                            format!("{} ({})", sampler_name, scheduler_name)
                        } else {
                            sampler_name.clone()
                        };
                        
                        // Overwrite if current is Unknown/empty/_ OR if we found a scheduler and current one likely doesn't have it
                        if meta.sampler == "Unknown" || meta.sampler.is_empty() || meta.sampler == "_" || (!scheduler_name.is_empty() && !meta.sampler.contains("(") && meta.sampler != full_name) {
                             meta.sampler = full_name;
                        }
                    }
                }

                 // 4. Trace Seed (from noise)
                if meta.seed == 0 {
                     if let Some(noise_id) = get_node_input_link(node, "noise") {
                         if let Some(noise_node) = nodes_map.get(&noise_id) {
                             if let Some(seed) = trace_node_param(nodes_map, noise_node, "noise_seed", 0).and_then(|v| v.as_i64()) {
                                 meta.seed = seed;
                             } else if let Some(seed) = trace_node_param(nodes_map, noise_node, "seed", 0).and_then(|v| v.as_i64()) {
                                 meta.seed = seed;
                             }
                         }
                     }
                }

                // 5. Trace Prompts (via Guider -> Conditioning)
                if meta.positive_prompt.is_empty() {
                    if let Some(guider_id) = get_node_input_link(node, "guider") {
                         if let Some(guider_node) = nodes_map.get(&guider_id) {
                             if let Some(cond_id) = get_node_input_link(guider_node, "conditioning") {
                                 if let Some(text) = trace_text_source(nodes_map, &cond_id) {
                                     meta.positive_prompt = text;
                                 }
                             }
                         }
                    }
                }
            }
        }
    }
    for (_id, node) in nodes_map {
        let class_type = get_node_type(node);
        
        // Standard LoraLoader / LoraLoaderModelOnly
        if class_type == "LoraLoader" || class_type == "LoraLoaderModelOnly" {
            if let Some(name) = get_node_param(node, "lora_name").and_then(|v| v.as_str()) {
                 let name = name.replace(".safetensors", "").replace(".ckpt", "");
                 let strength = get_node_param(node, "strength_model").and_then(|v| v.as_f64()).unwrap_or(1.0);
                 let entry = if strength != 1.0 { format!("{} ({:.2})", name, strength) } else { name };
                 if !meta.loras.contains(&entry) { meta.loras.push(entry); }
            }
        }
        
        // Custom LoraManager (User Request)
        if class_type == "Lora Loader (LoraManager)" {
             if let Some(loras_obj) = node.get("inputs").and_then(|v| v.get("loras")) {
                 if let Some(values) = loras_obj.get("__value__").and_then(|v| v.as_array()) {
                     for lora in values {
                         if let Some(name) = lora.get("name").and_then(|v| v.as_str()) {
                             let name = name.replace(".safetensors", "").replace(".ckpt", "");
                             let strength = lora.get("strength").and_then(|v| v.as_f64())
                                 .or_else(|| lora.get("strength").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()))
                                 .unwrap_or(1.0);
                             
                             let active = lora.get("active").and_then(|v| v.as_bool()).unwrap_or(true);
                             
                             if active {
                                 let entry = if strength != 1.0 { format!("{} ({:.2})", name, strength) } else { name };
                                 if !meta.loras.contains(&entry) { meta.loras.push(entry); }
                             }
                         }
                     }
                 }
             }
        }
    }

    // ---------------------------------------------------------
    // Fallback: Linear Scan for missing data
    // ---------------------------------------------------------

    // If Model is still unknown, scan all nodes for ANY valid loader
    if meta.model == "Unknown" || meta.model.is_empty() {
        for (_id, node) in nodes_map {
            // ONLY scan model loaders to avoid picking up secondary models from Save nodes
            if is_model_loader(get_node_type(node)) {
                if let Some(model_name) = extract_model_from_node(nodes_map, node) {
                    meta.model = model_name;
                    break;
                }
            }
        }
    }

    // If Steps/CFG/Sampler missing, scan for any KSampler-like node
    if meta.steps == 0 {
        for (_id, node) in nodes_map {
            let class_type = get_node_type(node).to_lowercase();
            if class_type.contains("ksampler") {
                 if meta.steps == 0 {
                     if let Some(v) = get_node_param(node, "steps").and_then(|v| v.as_u64()) { meta.steps = v as u32; }
                 }
                 if meta.cfg == 0.0 {
                     if let Some(v) = get_node_param(node, "cfg").and_then(|v| v.as_f64()) { meta.cfg = v as f32; }
                 }
                 if meta.seed == 0 {
                    if let Some(v) = get_node_param(node, "seed").and_then(|v| v.as_i64()) { meta.seed = v; }
                    else if let Some(v) = get_node_param(node, "noise_seed").and_then(|v| v.as_i64()) { meta.seed = v; }
                 }
                 if meta.sampler == "Unknown" {
                    if let Some(s) = get_node_param(node, "sampler_name").and_then(|s| s.as_str()) {
                        meta.sampler = s.to_string();
                        if let Some(sch) = get_node_param(node, "scheduler").and_then(|s| s.as_str()) {
                            meta.sampler = format!("{} ({})", meta.sampler, sch);
                        }
                    }
                 }
            }
        }
    }

    // Workflow format fallback: Extract sampler/scheduler from specialized nodes
    if meta.sampler == "Unknown" || meta.sampler.is_empty() || meta.sampler == "_" {
        let mut sampler_name = String::new();
        let mut scheduler_name = String::new();
        
        for (_id, node) in nodes_map {
            let node_type = get_node_type(node);
            
            // KSamplerSelect: widgets_values[0] = sampler_name (e.g., "euler")
            if node_type == "KSamplerSelect" {
                if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
                    if let Some(s) = arr.get(0).and_then(|v| v.as_str()) {
                        sampler_name = s.to_string();
                    }
                }
            }
            
            // BasicScheduler: widgets_values[0] = scheduler, [1] = steps, [2] = denoise
            if node_type == "BasicScheduler" {
                if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
                    if let Some(s) = arr.get(0).and_then(|v| v.as_str()) {
                        scheduler_name = s.to_string();
                    }
                    if meta.steps == 0 {
                        if let Some(steps) = arr.get(1).and_then(|v| v.as_u64()) {
                            meta.steps = steps as u32;
                        }
                    }
                }
            }
            
            // RandomNoise: widgets_values[0] = seed
            if node_type == "RandomNoise" && meta.seed == 0 {
                if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
                    if let Some(seed) = arr.get(0).and_then(|v| v.as_i64()) {
                        meta.seed = seed;
                    } else if let Some(seed) = arr.get(0).and_then(|v| v.as_u64()) {
                        meta.seed = seed as i64;
                    }
                }
            }
        }
        
        if !sampler_name.is_empty() {
            meta.sampler = if !scheduler_name.is_empty() {
                format!("{} ({})", sampler_name, scheduler_name)
            } else {
                sampler_name
            };
        }
    }

    // Final Prompt Fallback (for disconnected graphs)
    if meta.positive_prompt.is_empty() {
        let mut best_positive = None;
        for (id, node) in nodes_map {
            let t = get_node_type(node).to_lowercase();
            let title = get_node_title(node).unwrap_or("").to_lowercase();
            
            // Candidates for positive prompt
            if title.contains("positive") || (t.contains("cliptextencode") && !title.contains("negative")) || t.contains("showanything") {
                if let Some(text) = trace_text_source(nodes_map, id) {
                    if !text.trim().is_empty() {
                        best_positive = Some(text);
                        if title.contains("positive") { break; } // High confidence
                    }
                }
            }
        }
        if let Some(p) = best_positive { meta.positive_prompt = p; }
    }

    if meta.negative_prompt.is_empty() {
        for (id, node) in nodes_map {
            let title = get_node_title(node).unwrap_or("").to_lowercase();
            
            if title.contains("negative") {
                if let Some(text) = trace_text_source(nodes_map, id) {
                    if !text.trim().is_empty() {
                        meta.negative_prompt = text;
                        break;
                    }
                }
            }
        }
    }

    meta
}
