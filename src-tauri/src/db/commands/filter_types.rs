use chrono::{Datelike, Local, TimeZone};
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::types::Value;
use serde::Deserialize;
use specta::Type;
use std::collections::HashMap;

static TERM_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(-|!)?("(?:[^"\\]|\\.)*"|\S+)"#).unwrap());

#[derive(Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RustFilterState {
    pub search_query: String,
    pub models: Vec<String>,
    pub tools: Vec<String>,
    pub loras: Vec<String>,
    pub embeddings: Vec<String>,
    pub hypernetworks: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
    pub samplers: Vec<String>,
    pub generation_types: Vec<String>,
    pub date_range: String,
    pub favorites_only: bool,
    pub pinned_only: bool,
    pub show_intermediates: bool,
    pub show_grids: bool,
    pub collection_id: Option<String>,
    pub min_steps: Option<i32>,
    pub max_steps: Option<i32>,
    pub min_cfg: Option<f32>,
    pub max_cfg: Option<f32>,
    pub match_modes: Option<HashMap<String, String>>,
}

#[derive(Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RustCollection {
    pub id: String,
    pub name: String,
    pub filters: Option<RustFilterState>,
    pub manual_exclusions: Option<Vec<String>>,
}

impl RustFilterState {
    pub fn build_where_clause(
        &self,
        privacy_enabled: bool,
        masking_mode: &str,
        _masked_keywords: &[String],
        collections: &[RustCollection],
        is_recursive: bool,
        exclude_categories: &[String],
    ) -> (String, Vec<Value>) {
        let mut conditions: Vec<String> = Vec::new();
        let mut params: Vec<Value> = Vec::new();

        if !is_recursive {
            conditions.push("is_deleted = 0".to_string());

            if !self.show_intermediates {
                conditions.push("IFNULL(is_intermediate_gen, 0) = 0".to_string());
            }
            if !self.show_grids {
                conditions.push("IFNULL(is_grid_gen, 0) = 0".to_string());
            }
        }

        if privacy_enabled && masking_mode == "hide" {
            conditions.push("privacy_hidden = 0".to_string());
        }

        if let Some(ref col_id) = self.collection_id {
            let col = collections.iter().find(|c| c.id == *col_id);
            let mut sub_conditions = Vec::new();

            if let Some(c) = col {
                if let Some(ref filters) = c.filters {
                    let mut effective_smart_filters = filters.clone();
                    if self.date_range != "all" {
                        effective_smart_filters.date_range = "all".to_string();
                    }

                    let (smart_where, smart_params) = effective_smart_filters.build_where_clause(
                        false,
                        "blur",
                        &[],
                        &[],
                        true,
                        &[],
                    );

                    if !smart_where.is_empty() {
                        sub_conditions.push(format!("({})", smart_where));
                        params.extend(smart_params);
                    }
                }

                if !sub_conditions.is_empty() {
                    let mut combined = format!("({})", sub_conditions.join(" OR "));

                    if let Some(ref manual_exclusions) = c.manual_exclusions {
                        if !manual_exclusions.is_empty() {
                            let placeholders = manual_exclusions
                                .iter()
                                .map(|_| "?")
                                .collect::<Vec<_>>()
                                .join(",");
                            combined = format!("({} AND id NOT IN ({}))", combined, placeholders);
                            params.extend(manual_exclusions.iter().map(|s| Value::Text(s.clone())));
                        }
                    }

                    conditions.push(combined);
                }
            }
        }

        if self.favorites_only {
            conditions.push("is_favorite = 1".to_string());
        }

        if self.pinned_only {
            conditions.push("is_pinned = 1".to_string());
        }

        if !self.models.is_empty() && !exclude_categories.contains(&"models".to_string()) {
            let match_mode = self
                .match_modes
                .as_ref()
                .and_then(|m| m.get("models"))
                .map(|s| s.as_str())
                .unwrap_or("any");
            let mut model_conditions = Vec::new();
            for m in &self.models {
                if m == "Unknown" {
                    model_conditions.push(
                        "(resolved_model_name IS NULL OR resolved_model_name = '' OR resolved_model_name = 'Unknown')"
                            .to_string(),
                    );
                } else {
                    params.push(Value::Text(m.clone()));
                    model_conditions.push("resolved_model_name = ? COLLATE NOCASE".to_string());
                }
            }
            let joiner = if match_mode == "all" { " AND " } else { " OR " };
            conditions.push(format!("({})", model_conditions.join(joiner)));
        }

        if !self.tools.is_empty() && !exclude_categories.contains(&"tools".to_string()) {
            let match_mode = self
                .match_modes
                .as_ref()
                .and_then(|m| m.get("tools"))
                .map(|s| s.as_str())
                .unwrap_or("any");
            let mut tool_conditions = Vec::new();
            for t in &self.tools {
                if t == "Unknown" {
                    tool_conditions.push("(tool = 'Unknown' OR tool IS NULL)".to_string());
                } else {
                    params.push(Value::Text(t.clone()));
                    tool_conditions.push("tool = ? COLLATE NOCASE".to_string());
                }
            }
            let joiner = if match_mode == "all" { " AND " } else { " OR " };
            conditions.push(format!("({})", tool_conditions.join(joiner)));
        }

        let lora_mode = self
            .match_modes
            .as_ref()
            .and_then(|m| m.get("loras"))
            .map(|s| s.as_str())
            .unwrap_or("any");
        if !exclude_categories.contains(&"loras".to_string()) {
            if self.loras.len() == 1 && lora_mode == "any" {
            } else if !self.loras.is_empty() {
                let mut lora_conditions = Vec::new();
                for l in &self.loras {
                    params.push(Value::Text(l.clone()));
                    lora_conditions.push(
                        "EXISTS (SELECT 1 FROM image_loras il WHERE il.image_id = id AND il.lora_name = ? COLLATE NOCASE)"
                            .to_string(),
                    );
                }
                let joiner = if lora_mode == "all" { " AND " } else { " OR " };
                conditions.push(format!("({})", lora_conditions.join(joiner)));
            }
        }

        let emb_mode = self
            .match_modes
            .as_ref()
            .and_then(|m| m.get("embeddings"))
            .map(|s| s.as_str())
            .unwrap_or("any");
        if !self.embeddings.is_empty() && !exclude_categories.contains(&"embeddings".to_string()) {
            let mut emb_conditions = Vec::new();
            for e in &self.embeddings {
                params.push(Value::Text(e.clone()));
                emb_conditions.push(
                    "EXISTS (SELECT 1 FROM image_embeddings ie WHERE ie.image_id = id AND ie.embedding_name = ? COLLATE NOCASE)"
                        .to_string(),
                );
            }
            let joiner = if emb_mode == "all" { " AND " } else { " OR " };
            conditions.push(format!("({})", emb_conditions.join(joiner)));
        }

        let hn_mode = self
            .match_modes
            .as_ref()
            .and_then(|m| m.get("hypernetworks"))
            .map(|s| s.as_str())
            .unwrap_or("any");
        if !self.hypernetworks.is_empty()
            && !exclude_categories.contains(&"hypernetworks".to_string())
        {
            let mut hn_conditions = Vec::new();
            for h in &self.hypernetworks {
                params.push(Value::Text(h.clone()));
                hn_conditions.push(
                    "EXISTS (SELECT 1 FROM image_hypernetworks ih WHERE ih.image_id = id AND ih.hypernetwork_name = ? COLLATE NOCASE)"
                        .to_string(),
                );
            }
            let joiner = if hn_mode == "all" { " AND " } else { " OR " };
            conditions.push(format!("({})", hn_conditions.join(joiner)));
        }

        let cn_mode = self
            .match_modes
            .as_ref()
            .and_then(|m| m.get("controlNets"))
            .map(|s| s.as_str())
            .unwrap_or("any");
        if !self.control_nets.is_empty() && !exclude_categories.contains(&"controlNets".to_string())
        {
            let mut cn_conditions = Vec::new();
            for c in &self.control_nets {
                params.push(Value::Text(c.clone()));
                cn_conditions.push(
                    "EXISTS (SELECT 1 FROM image_controlnets cn WHERE cn.image_id = id AND cn.controlnet_name = ? COLLATE NOCASE)"
                        .to_string(),
                );
            }
            let joiner = if cn_mode == "all" { " AND " } else { " OR " };
            conditions.push(format!("({})", cn_conditions.join(joiner)));
        }

        let ip_mode = self
            .match_modes
            .as_ref()
            .and_then(|m| m.get("ipAdapters"))
            .map(|s| s.as_str())
            .unwrap_or("any");
        if !self.ip_adapters.is_empty() && !exclude_categories.contains(&"ipAdapters".to_string()) {
            let mut ip_conditions = Vec::new();
            for i in &self.ip_adapters {
                params.push(Value::Text(i.clone()));
                ip_conditions.push(
                    "EXISTS (SELECT 1 FROM image_ipadapters ip WHERE ip.image_id = id AND ip.ipadapter_name = ? COLLATE NOCASE)"
                        .to_string(),
                );
            }
            let joiner = if ip_mode == "all" { " AND " } else { " OR " };
            conditions.push(format!("({})", ip_conditions.join(joiner)));
        }

        if !self.search_query.is_empty() {
            for caps in TERM_REGEX.captures_iter(&self.search_query) {
                let is_negative = caps.get(1).is_some();
                let mut term = caps.get(2).unwrap().as_str().to_string();

                if term.starts_with('"') && term.ends_with('"') {
                    term = term[1..term.len() - 1].replace(r#"\"#, "\"");
                }

                let lower_term = term.to_lowercase();
                if lower_term.contains(':') && !lower_term.starts_with(':') {
                    let parts: Vec<&str> = lower_term.splitn(2, ':').collect();
                    let key = parts[0];
                    let val = parts[1];

                    let mut sql = String::new();
                    let mut param: Option<Value> = None;

                    match key {
                        "steps" => {
                            if let Some(stripped) = val.strip_prefix('>') {
                                sql = "steps > ?".to_string();
                                param = stripped
                                    .parse::<i32>()
                                    .ok()
                                    .map(|v| Value::Integer(v as i64));
                            } else if let Some(stripped) = val.strip_prefix('<') {
                                sql = "steps < ?".to_string();
                                param = stripped
                                    .parse::<i32>()
                                    .ok()
                                    .map(|v| Value::Integer(v as i64));
                            } else {
                                sql = "steps = ?".to_string();
                                param = val.parse::<i32>().ok().map(|v| Value::Integer(v as i64));
                            }
                        }
                        "cfg" => {
                            if let Some(stripped) = val.strip_prefix('>') {
                                sql = "cfg > ?".to_string();
                                param = stripped.parse::<f64>().ok().map(Value::Real);
                            } else if let Some(stripped) = val.strip_prefix('<') {
                                sql = "cfg < ?".to_string();
                                param = stripped.parse::<f64>().ok().map(Value::Real);
                            } else {
                                sql = "cfg = ?".to_string();
                                param = val.parse::<f64>().ok().map(Value::Real);
                            }
                        }
                        "w" | "width" => {
                            if let Some(stripped) = val.strip_prefix('>') {
                                sql = "width > ?".to_string();
                                param = stripped
                                    .parse::<i32>()
                                    .ok()
                                    .map(|v| Value::Integer(v as i64));
                            } else if let Some(stripped) = val.strip_prefix('<') {
                                sql = "width < ?".to_string();
                                param = stripped
                                    .parse::<i32>()
                                    .ok()
                                    .map(|v| Value::Integer(v as i64));
                            } else {
                                sql = "width = ?".to_string();
                                param = val.parse::<i32>().ok().map(|v| Value::Integer(v as i64));
                            }
                        }
                        "h" | "height" => {
                            if let Some(stripped) = val.strip_prefix('>') {
                                sql = "height > ?".to_string();
                                param = stripped
                                    .parse::<i32>()
                                    .ok()
                                    .map(|v| Value::Integer(v as i64));
                            } else if let Some(stripped) = val.strip_prefix('<') {
                                sql = "height < ?".to_string();
                                param = stripped
                                    .parse::<i32>()
                                    .ok()
                                    .map(|v| Value::Integer(v as i64));
                            } else {
                                sql = "height = ?".to_string();
                                param = val.parse::<i32>().ok().map(|v| Value::Integer(v as i64));
                            }
                        }
                        "model" => {
                            let p = format!("%{}%", val);
                            conditions.push(
                                "(resolved_model_name LIKE ? OR json_extract(metadata_json, '$.model') LIKE ?)"
                                    .to_string(),
                            );
                            params.push(Value::Text(p.clone()));
                            params.push(Value::Text(p));
                            continue;
                        }
                        "seed" => {
                            sql = "json_extract(metadata_json, '$.seed') LIKE ?".to_string();
                            param = Some(Value::Text(format!("%{}%", val)));
                        }
                        "neg" | "negative" => {
                            sql = "negative_prompt LIKE ?".to_string();
                            param = Some(Value::Text(format!("%{}%", val)));
                        }
                        "file" | "filename" | "path" => {
                            sql = "path LIKE ?".to_string();
                            param = Some(Value::Text(format!("%{}%", val)));
                        }
                        "all" => {
                            let p = format!("%{}%", val);
                            if is_negative {
                                conditions.push(
                                    "(path NOT LIKE ? AND metadata_json NOT LIKE ?)".to_string(),
                                );
                            } else {
                                conditions
                                    .push("(path LIKE ? OR metadata_json LIKE ?)".to_string());
                            }
                            params.push(Value::Text(p.clone()));
                            params.push(Value::Text(p));
                            continue;
                        }
                        "sampler" => {
                            sql = "sampler LIKE ?".to_string();
                            param = Some(Value::Text(format!("%{}%", val)));
                        }
                        "tool" => {
                            sql = "tool LIKE ?".to_string();
                            param = Some(Value::Text(format!("%{}%", val)));
                        }
                        "lora" => {
                            sql = "EXISTS (SELECT 1 FROM image_loras il WHERE il.image_id = id AND il.lora_name LIKE ?)".to_string();
                            param = Some(Value::Text(format!("%{}%", val)));
                        }
                        "cn" | "controlnet" => {
                            sql = "EXISTS (SELECT 1 FROM image_controlnets cn WHERE cn.image_id = id AND cn.controlnet_name LIKE ?)".to_string();
                            param = Some(Value::Text(format!("%{}%", val)));
                        }
                        "ip" | "ipadapter" => {
                            sql = "EXISTS (SELECT 1 FROM image_ipadapters ip WHERE ip.image_id = id AND ip.ipadapter_name LIKE ?)".to_string();
                            param = Some(Value::Text(format!("%{}%", val)));
                        }
                        "upscaled" => {
                            sql = "json_extract(metadata_json, '$.upscaled') = ?".to_string();
                            param = Some(Value::Integer(if val == "true" { 1 } else { 0 }));
                        }
                        _ => {}
                    }

                    if !sql.is_empty() {
                        if let Some(p) = param {
                            if is_negative {
                                conditions.push(format!("NOT ({})", sql));
                            } else {
                                conditions.push(sql);
                            }
                            params.push(p);
                        }
                    }
                } else {
                    if is_negative {
                        conditions.push("positive_prompt NOT LIKE ?".to_string());
                    } else {
                        conditions.push("positive_prompt LIKE ?".to_string());
                    }
                    params.push(Value::Text(format!("%{}%", term)));
                }
            }
        }

        if let Some(min_steps) = self.min_steps {
            conditions.push("steps >= ?".to_string());
            params.push(Value::Integer(min_steps as i64));
        }
        if let Some(max_steps) = self.max_steps {
            conditions.push("steps <= ?".to_string());
            params.push(Value::Integer(max_steps as i64));
        }
        if let Some(min_cfg) = self.min_cfg {
            conditions.push("cfg >= ?".to_string());
            params.push(Value::Real(min_cfg as f64));
        }
        if let Some(max_cfg) = self.max_cfg {
            conditions.push("cfg <= ?".to_string());
            params.push(Value::Real(max_cfg as f64));
        }

        if !self.samplers.is_empty() && !exclude_categories.contains(&"samplers".to_string()) {
            let sampler_conditions = self
                .samplers
                .iter()
                .map(|_| "sampler = ?")
                .collect::<Vec<_>>()
                .join(" OR ");
            for s in &self.samplers {
                params.push(Value::Text(s.to_lowercase().replace(['_', '-'], " ")));
            }
            conditions.push(format!("({})", sampler_conditions));
        }

        if !self.generation_types.is_empty()
            && !exclude_categories.contains(&"generationTypes".to_string())
        {
            let gen_type_conditions = self
                .generation_types
                .iter()
                .map(|_| "generation_type = ?")
                .collect::<Vec<_>>()
                .join(" OR ");
            for gt in &self.generation_types {
                params.push(Value::Text(gt.clone()));
            }
            conditions.push(format!("({})", gen_type_conditions));
        }

        if self.date_range != "all" {
            let now = Local::now();
            let midnight = Local
                .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
                .unwrap();
            let today_start = midnight.timestamp_millis();
            let day_ms = 24 * 60 * 60 * 1000;

            let mut cut_off = 0;
            match self.date_range.as_str() {
                "today" => cut_off = today_start,
                "week" => cut_off = today_start - (7 * day_ms),
                "month" => cut_off = today_start - (30 * day_ms),
                _ => {}
            }

            if cut_off > 0 {
                conditions.push("timestamp >= ?".to_string());
                params.push(Value::Integer(cut_off));
            }
        }

        let mut where_clause = if conditions.is_empty() {
            String::new()
        } else {
            conditions.join(" AND ")
        };

        if !is_recursive && !where_clause.is_empty() {
            where_clause = format!("WHERE {}", where_clause);
        }

        (where_clause, params)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_default_filter() -> RustFilterState {
        RustFilterState {
            search_query: "".to_string(),
            models: vec![],
            tools: vec![],
            loras: vec![],
            embeddings: vec![],
            hypernetworks: vec![],
            control_nets: vec![],
            ip_adapters: vec![],
            samplers: vec![],
            generation_types: vec![],
            date_range: "all".to_string(),
            favorites_only: false,
            pinned_only: false,
            show_intermediates: false,
            show_grids: false,
            collection_id: None,
            min_steps: None,
            max_steps: None,
            min_cfg: None,
            max_cfg: None,
            match_modes: None,
        }
    }

    #[test]
    fn test_basic_where_clause() {
        let filter = create_default_filter();
        let (sql, params) = filter.build_where_clause(false, "blur", &[], &[], false, &[]);
        assert!(sql.contains("WHERE is_deleted = 0"));
        assert!(sql.contains("IFNULL(is_intermediate_gen, 0) = 0"));
        assert!(sql.contains("IFNULL(is_grid_gen, 0) = 0"));
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_favorites_and_pinned() {
        let mut filter = create_default_filter();
        filter.favorites_only = true;
        filter.pinned_only = true;
        let (sql, _) = filter.build_where_clause(false, "blur", &[], &[], false, &[]);
        assert!(sql.contains("is_favorite = 1"));
        assert!(sql.contains("is_pinned = 1"));
    }

    #[test]
    fn test_search_query() {
        let mut filter = create_default_filter();
        filter.search_query = "cat steps:>20 -dog".to_string();
        let (sql, params) = filter.build_where_clause(false, "blur", &[], &[], false, &[]);

        assert!(sql.contains("positive_prompt LIKE ?"));
        assert!(sql.contains("steps > ?"));
        assert!(sql.contains("positive_prompt NOT LIKE ?"));

        assert_eq!(params.len(), 3);
        assert_eq!(params[0], Value::Text("%cat%".to_string()));
        assert_eq!(params[1], Value::Integer(20));
        assert_eq!(params[2], Value::Text("%dog%".to_string()));
    }

    #[test]
    fn test_models_filter() {
        let mut filter = create_default_filter();
        filter.models = vec!["Model A".to_string(), "Unknown".to_string()];
        let (sql, params) = filter.build_where_clause(false, "blur", &[], &[], false, &[]);

        assert!(sql.contains("(resolved_model_name = ? COLLATE NOCASE OR (resolved_model_name IS NULL OR resolved_model_name = '' OR resolved_model_name = 'Unknown'))"));
        assert_eq!(params.len(), 1);
        assert_eq!(params[0], Value::Text("Model A".to_string()));
    }

    #[test]
    fn test_privacy_filter() {
        let filter = create_default_filter();
        let (sql, params) =
            filter.build_where_clause(true, "hide", &["secret".to_string()], &[], false, &[]);

        assert!(sql.contains("privacy_hidden = 0"));
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_smart_collection() {
        let smart_filter = RustFilterState {
            search_query: "smart".to_string(),
            ..create_default_filter()
        };
        let collection = RustCollection {
            id: "col1".to_string(),
            name: "My Collection".to_string(),
            filters: Some(smart_filter),
            manual_exclusions: Some(vec!["img1".to_string()]),
        };

        let mut filter = create_default_filter();
        filter.collection_id = Some("col1".to_string());

        let (sql, params) =
            filter.build_where_clause(false, "blur", &[], &[collection], false, &[]);

        assert!(sql.contains("is_deleted = 0"));
        assert!(sql.contains("(positive_prompt LIKE ?)"));
        assert!(sql.contains("AND id NOT IN (?)"));
        assert_eq!(params.len(), 2);
        assert_eq!(params[0], Value::Text("%smart%".to_string()));
        assert_eq!(params[1], Value::Text("img1".to_string()));
    }
}
