import { FilterState, AppSettings, Collection } from '../types';

export const buildSqlWhereClause = (
    filters: FilterState,
    privacyEnabled: boolean,
    maskingMode: AppSettings['maskingMode'],
    maskedKeywords: string[],
    collections?: Collection[]
): { where: string; params: any[] } => {
    const conditions: string[] = [];
    const params: any[] = [];

    // Base Condition: Not Deleted and Not Intermediate
    conditions.push('is_deleted = 0');
    conditions.push("(json_extract(metadata_json, '$.isIntermediate') IS NULL OR json_extract(metadata_json, '$.isIntermediate') != 1)");

    // 1. Privacy Logic
    if (privacyEnabled && maskingMode === 'hide' && maskedKeywords.length > 0) {
        // Construct NOT LIKE clauses for each keyword
        const privacyConditions = maskedKeywords.map(kw => {
            params.push(`%${kw}%`);
            return `metadata_json NOT LIKE ?`;
        });
        conditions.push(`(${privacyConditions.join(' AND ')})`);
    }

    // 2. Collection ID
    if (filters.collectionId) {
        const manualCol = collections?.find(c => c.id === filters.collectionId);
        // Only use IN (...) if we actually have IDs populated (Manual Collection)
        if (manualCol && manualCol.imageIds && manualCol.imageIds.length > 0) {
            const ids = manualCol.imageIds.map(id => id.replace(/\\/g, '/').replace(/\/+/g, '/'));
            const placeholders = ids.map(() => '?').join(',');
            conditions.push(`path IN (${placeholders})`);
            params.push(...ids);
        } else {
            // Default: Filter by Board ID (Efficient)
            conditions.push('board_id = ?');
            params.push(filters.collectionId);
        }
    }


    // 3. Favorites
    if (filters.favoritesOnly) {
        conditions.push('is_favorite = 1');
    }

    // 4. Models (Array)
    if (filters.models.length > 0) {
        // We check overrideModel OR metadata.model
        // JSON structure: { "model": "..." } or { "overrideModel": "..." }
        // Simple approach: Check if metadata_json contains the model name
        // Robust approach: json_extract
        const modelConditions = filters.models.map(m => {
            params.push(`%${m}%`);
            return `metadata_json LIKE ?`;
            // Note: This is loose matching. For strict:
            // json_extract(metadata_json, '$.model') = ?
        });
        conditions.push(`(${modelConditions.join(' OR ')})`);
    }

    // 5. Tools (Array)
    if (filters.tools.length > 0) {
        const toolConditions = filters.tools.map(t => {
            if (t === 'Unknown') {
                return `(json_extract(metadata_json, '$.tool') = 'Unknown' OR json_extract(metadata_json, '$.tool') IS NULL)`;
            }
            params.push(t);
            return `json_extract(metadata_json, '$.tool') = ?`;
        });
        conditions.push(`(${toolConditions.join(' OR ')})`);
    }

    // 6. LoRAs (Array)
    if (filters.loras.length > 0) {
        // LoRA names are inside an array in JSON or string. 
        // We'll use simple LIKE for now as it's efficient enough for JSON text
        const loraConditions = filters.loras.map(l => {
            params.push(`%${l}%`);
            return `metadata_json LIKE ?`;
        });
        conditions.push(`(${loraConditions.join(' OR ')})`);
    }

    // 7. Search Query (Advanced)
    if (filters.searchQuery) {
        // Regex to handle quoted phrases or single terms, optionally prefixed with - or !
        const termRegex = /(-|!)?("(?:[^"\\]|\\.)*"|\S+)/g;
        let match;

        while ((match = termRegex.exec(filters.searchQuery)) !== null) {
            const prefix = match[1]; // - or !
            const isNegative = !!prefix;
            let term = match[2];

            // Remove quotes if present
            if (term.startsWith('"') && term.endsWith('"')) {
                term = term.slice(1, -1).replace(/\\"/g, '"');
            }

            const lowerTerm = term.toLowerCase();
            if (lowerTerm.includes(':') && !lowerTerm.startsWith(':')) {
                const [key, val] = lowerTerm.split(':');
                const isNumeric = ['steps', 'cfg', 'w', 'width', 'h', 'height'].includes(key);

                let sql = '';
                let param: any = val;

                if (key === 'steps') {
                    if (val.startsWith('>')) { sql = "CAST(json_extract(metadata_json, '$.steps') AS INTEGER) > ?"; param = Number(val.slice(1)); }
                    else if (val.startsWith('<')) { sql = "CAST(json_extract(metadata_json, '$.steps') AS INTEGER) < ?"; param = Number(val.slice(1)); }
                    else { sql = "CAST(json_extract(metadata_json, '$.steps') AS INTEGER) = ?"; param = Number(val); }
                } else if (key === 'cfg') {
                    if (val.startsWith('>')) { sql = "CAST(json_extract(metadata_json, '$.cfg') AS FLOAT) > ?"; param = Number(val.slice(1)); }
                    else if (val.startsWith('<')) { sql = "CAST(json_extract(metadata_json, '$.cfg') AS FLOAT) < ?"; param = Number(val.slice(1)); }
                    else { sql = "CAST(json_extract(metadata_json, '$.cfg') AS FLOAT) = ?"; param = Number(val); }
                } else if (key === 'w' || key === 'width') {
                    if (val.startsWith('>')) { sql = "width > ?"; param = Number(val.slice(1)); }
                    else if (val.startsWith('<')) { sql = "width < ?"; param = Number(val.slice(1)); }
                    else { sql = "width = ?"; param = Number(val); }
                } else if (key === 'h' || key === 'height') {
                    if (val.startsWith('>')) { sql = "height > ?"; param = Number(val.slice(1)); }
                    else if (val.startsWith('<')) { sql = "height < ?"; param = Number(val.slice(1)); }
                    else { sql = "height = ?"; param = Number(val); }
                } else if (key === 'model') {
                    sql = `metadata_json LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'seed') {
                    sql = `json_extract(metadata_json, '$.seed') LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'neg' || key === 'negative') {
                    sql = `json_extract(metadata_json, '$.negativePrompt') LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'sampler') {
                    sql = `json_extract(metadata_json, '$.sampler') LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'tool') {
                    sql = `json_extract(metadata_json, '$.tool') LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'lora') {
                    sql = `json_extract(metadata_json, '$.loras') LIKE ?`;
                    param = `%${val}%`;
                } else if (key === 'upscaled') {
                    sql = `json_extract(metadata_json, '$.upscaled') = ?`;
                    param = val === 'true' ? 1 : 0;
                }

                if (sql) {
                    if (isNegative) {
                        conditions.push(`NOT (${sql})`);
                    } else {
                        conditions.push(sql);
                    }
                    params.push(param);
                }
            } else {
                // General text search (Prompts, Filename)
                if (isNegative) {
                    conditions.push(`(path NOT LIKE ? AND metadata_json NOT LIKE ?)`);
                } else {
                    conditions.push(`(path LIKE ? OR metadata_json LIKE ?)`);
                }
                params.push(`%${term}%`);
                params.push(`%${term}%`);
            }
        }
    }

    // 8. Range Sliders
    if (filters.minSteps !== undefined) {
        conditions.push("CAST(json_extract(metadata_json, '$.steps') AS INTEGER) >= ?");
        params.push(filters.minSteps);
    }
    if (filters.maxSteps !== undefined) {
        conditions.push("CAST(json_extract(metadata_json, '$.steps') AS INTEGER) <= ?");
        params.push(filters.maxSteps);
    }
    if (filters.minCfg !== undefined) {
        conditions.push("CAST(json_extract(metadata_json, '$.cfg') AS FLOAT) >= ?");
        params.push(filters.minCfg);
    }
    if (filters.maxCfg !== undefined) {
        conditions.push("CAST(json_extract(metadata_json, '$.cfg') AS FLOAT) <= ?");
        params.push(filters.maxCfg);
    }

    // 9. Date Range
    if (filters.dateRange !== 'all') {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        let cutOff = 0;
        if (filters.dateRange === 'today') cutOff = now - day;
        if (filters.dateRange === 'week') cutOff = now - (7 * day);
        if (filters.dateRange === 'month') cutOff = now - (30 * day);

        if (cutOff > 0) {
            conditions.push('timestamp >= ?');
            params.push(cutOff);
        }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { where, params };
};
