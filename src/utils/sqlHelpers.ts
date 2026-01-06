import { FilterState, AppSettings, Collection } from '../types';

export const buildSqlWhereClause = (
    filters: FilterState,
    privacyEnabled: boolean,
    maskingMode: AppSettings['maskingMode'],
    maskedKeywords: string[],
    collections?: Collection[],
    isRecursive: boolean = false
): { where: string; params: any[] } => {
    const conditions: string[] = [];
    const params: any[] = [];

    // Base Condition: Not Deleted
    if (!isRecursive) {
        conditions.push('is_deleted = 0');

        if (!filters.showIntermediates) {
            conditions.push("(is_intermediate_gen IS NULL OR is_intermediate_gen != 1)");
        }
        if (!filters.showGrids) {
            conditions.push("(is_grid_gen IS NULL OR is_grid_gen != 1) AND (json_extract(metadata_json, '$.generationType') IS NULL OR json_extract(metadata_json, '$.generationType') != 'grid')");
        }
    }

    // 1. Privacy Logic
    if (privacyEnabled && maskingMode === 'hide' && maskedKeywords.length > 0) {
        // Construct NOT LIKE clauses for each keyword
        const privacyConditions = maskedKeywords.map(kw => {
            params.push(`%${kw}%`);
            return `metadata_json NOT LIKE ?`;
        });
        conditions.push(`(${privacyConditions.join(' AND ')})`);
    }

    // 2. Collection ID (Hybrid Logic)
    if (filters.collectionId) {
        const col = collections?.find(c => c.id === filters.collectionId);
        const subConditions: string[] = [];

        // A. Manual Inclusions (via Junction Table)
        subConditions.push(`id IN (SELECT image_id FROM collection_images WHERE collection_id = ?)`);
        params.push(filters.collectionId);

        // B. Smart Filter Rules (Hybrid Mode)
        // If the collection defines smart rules, we combine them with manual inclusions using OR.
        if (col && col.filters) {
            /** 
             * DATE PRE-EMPTION LOGIC:
             * If the user has selected a GLOBAL date filter (e.g. "Today") in the filter panel,
             * it should take precedence over any date range saved inside the smart collection's own rules.
             * This allows "narrowing down" a smart collection by date.
             */
            const effectiveSmartFilters = { ...col.filters };
            if (filters.dateRange !== 'all') {
                effectiveSmartFilters.dateRange = 'all'; // Disable internal date rule to let global one apply
            }

            // Recursively build conditions for the smart rules
            // We set isRecursive=true to skip repeating base constraints (is_deleted, privacy)
            const { where: smartWhere, params: smartParams } = buildSqlWhereClause(
                effectiveSmartFilters,
                false,   // privacy handled by parent
                'blur',
                [],
                [],
                true     // isRecursive
            );

            if (smartWhere) {
                subConditions.push(`(${smartWhere})`);
                params.push(...smartParams);
            }
        }

        if (subConditions.length > 0) {
            let combined = `(${subConditions.join(' OR ')})`;

            // C. Manual Exclusions
            if (col && col.manualExclusions && col.manualExclusions.length > 0) {
                const placeholders = col.manualExclusions.map(() => '?').join(',');
                combined = `(${combined} AND id NOT IN (${placeholders}))`;
                params.push(...col.manualExclusions);
            }

            conditions.push(combined);
        }
    }


    // 3. Favorites
    if (filters.favoritesOnly) {
        conditions.push('is_favorite = 1');
    }

    // 4. Pinned Only
    if (filters.pinnedOnly) {
        conditions.push('is_pinned = 1');
    }

    // 5. Models (Array) - Use denormalized resolved_model_name and model_hash columns
    if (filters.models.length > 0) {
        const modelConditions = filters.models.map(m => {
            if (m === 'Unknown') {
                return `(resolved_model_name IS NULL OR resolved_model_name = '' OR resolved_model_name = 'Unknown')`;
            }
            params.push(m);
            // Use indexed resolved_model_name column for fast lookup
            return `resolved_model_name = ?`;
        });
        conditions.push(`(${modelConditions.join(' OR ')})`);
    }

    // 5. Tools (Array) - Use denormalized tool column
    if (filters.tools.length > 0) {
        const toolConditions = filters.tools.map(t => {
            if (t === 'Unknown') {
                return `(tool = 'Unknown' OR tool IS NULL)`;
            }
            params.push(t);
            return `tool = ?`;
        });
        conditions.push(`(${toolConditions.join(' OR ')})`);
    }

    // 6. LoRAs, Embeddings, Hypernetworks (Arrays)
    if (filters.loras.length > 0) {
        const loraConditions = filters.loras.map(l => {
            params.push(l);
            params.push(l + ' (%');
            params.push(l + ':%');
            return `EXISTS (SELECT 1 FROM json_each(metadata_json, '$.loras') WHERE value = ? OR value LIKE ? OR value LIKE ?)`;
        });
        conditions.push(`(${loraConditions.join(' OR ')})`);
    }

    if (filters.embeddings.length > 0) {
        const embConditions = filters.embeddings.map(e => {
            params.push(e);
            params.push(e + ' (%');
            params.push(e + ':%');
            return `EXISTS (SELECT 1 FROM json_each(metadata_json, '$.embeddings') WHERE value = ? OR value LIKE ? OR value LIKE ?)`;
        });
        conditions.push(`(${embConditions.join(' OR ')})`);
    }

    if (filters.hypernetworks.length > 0) {
        const hnConditions = filters.hypernetworks.map(h => {
            params.push(h);
            params.push(h + ' (%');
            params.push(h + ':%');
            return `EXISTS (SELECT 1 FROM json_each(metadata_json, '$.hypernetworks') WHERE value = ? OR value LIKE ? OR value LIKE ?)`;
        });
        conditions.push(`(${hnConditions.join(' OR ')})`);
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
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const todayStart = midnight.getTime();
        const day = 24 * 60 * 60 * 1000;

        let cutOff = 0;
        if (filters.dateRange === 'today') cutOff = todayStart;
        if (filters.dateRange === 'week') cutOff = todayStart - (7 * day);
        if (filters.dateRange === 'month') cutOff = todayStart - (30 * day);

        if (cutOff > 0) {
            conditions.push('timestamp >= ?');
            params.push(cutOff);
        }
    }

    const where = conditions.length > 0 ? (isRecursive ? conditions.join(' AND ') : `WHERE ${conditions.join(' AND ')}`) : '';
    return { where, params };
};
