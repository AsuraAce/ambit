import { FilterState, AppSettings, Collection } from '../types';

type SqlParam = string | number;

interface SearchToken {
    term: string;
    isNegative: boolean;
    isOrOperator: boolean;
}

interface SearchCondition {
    sql: string;
    params: SqlParam[];
    isPositivePrompt: boolean;
}

const tokenizeSearchQuery = (query: string): SearchToken[] => {
    const termRegex = /(-|!)?("(?:[^"\\]|\\.)*"|\S+)/g;
    const tokens: SearchToken[] = [];
    let match: RegExpExecArray | null;

    while ((match = termRegex.exec(query)) !== null) {
        const prefix = match[1];
        const isNegative = !!prefix;
        const rawTerm = match[2];
        const isQuoted = rawTerm.startsWith('"') && rawTerm.endsWith('"');
        const term = isQuoted
            ? rawTerm.slice(1, -1).replace(/\\"/g, '"')
            : rawTerm;

        tokens.push({
            term,
            isNegative,
            isOrOperator: !isNegative && !isQuoted && term.toLowerCase() === 'or'
        });
    }

    return tokens;
};

const parseSearchToken = (token: SearchToken): SearchCondition | null => {
    const lowerTerm = token.term.toLowerCase();

    if (lowerTerm.includes(':') && !lowerTerm.startsWith(':')) {
        const [key, val] = lowerTerm.split(':');

        let sql = '';
        let param: SqlParam = val;

        if (key === 'steps') {
            if (val.startsWith('>')) { sql = "steps > ?"; param = Number(val.slice(1)); }
            else if (val.startsWith('<')) { sql = "steps < ?"; param = Number(val.slice(1)); }
            else { sql = "steps = ?"; param = Number(val); }
        } else if (key === 'cfg') {
            if (val.startsWith('>')) { sql = "cfg > ?"; param = Number(val.slice(1)); }
            else if (val.startsWith('<')) { sql = "cfg < ?"; param = Number(val.slice(1)); }
            else { sql = "cfg = ?"; param = Number(val); }
        } else if (key === 'w' || key === 'width') {
            if (val.startsWith('>')) { sql = "width > ?"; param = Number(val.slice(1)); }
            else if (val.startsWith('<')) { sql = "width < ?"; param = Number(val.slice(1)); }
            else { sql = "width = ?"; param = Number(val); }
        } else if (key === 'h' || key === 'height') {
            if (val.startsWith('>')) { sql = "height > ?"; param = Number(val.slice(1)); }
            else if (val.startsWith('<')) { sql = "height < ?"; param = Number(val.slice(1)); }
            else { sql = "height = ?"; param = Number(val); }
        } else if (key === 'model') {
            const modelParam = `%${val}%`;
            return {
                sql: `(resolved_model_name LIKE ? OR json_extract(metadata_json, '$.model') LIKE ?)`,
                params: [modelParam, modelParam],
                isPositivePrompt: false
            };
        } else if (key === 'seed') {
            sql = `json_extract(metadata_json, '$.seed') LIKE ?`;
            param = `%${val}%`;
        } else if (key === 'neg' || key === 'negative') {
            sql = `negative_prompt LIKE ?`;
            param = `%${val}%`;
        } else if (key === 'file' || key === 'filename' || key === 'path') {
            sql = `path LIKE ?`;
            param = `%${val}%`;
        } else if (key === 'all') {
            const allParam = `%${val}%`;
            return {
                sql: token.isNegative
                    ? `(path NOT LIKE ? AND metadata_json NOT LIKE ?)`
                    : `(path LIKE ? OR metadata_json LIKE ?)`,
                params: [allParam, allParam],
                isPositivePrompt: false
            };
        } else if (key === 'sampler') {
            sql = `sampler LIKE ?`;
            param = `%${val}%`;
        } else if (key === 'tool') {
            sql = `tool LIKE ?`;
            param = `%${val}%`;
        } else if (key === 'lora') {
            sql = `EXISTS (SELECT 1 FROM image_loras il WHERE il.image_id = id AND il.lora_name LIKE ?)`;
            param = `%${val}%`;
        } else if (key === 'cn' || key === 'controlnet') {
            sql = `EXISTS (SELECT 1 FROM image_controlnets cn WHERE cn.image_id = id AND cn.controlnet_name LIKE ?)`;
            param = `%${val}%`;
        } else if (key === 'ip' || key === 'ipadapter') {
            sql = `EXISTS (SELECT 1 FROM image_ipadapters ip WHERE ip.image_id = id AND ip.ipadapter_name LIKE ?)`;
            param = `%${val}%`;
        } else if (key === 'upscaled') {
            sql = `json_extract(metadata_json, '$.upscaled') = ?`;
            param = val === 'true' ? 1 : 0;
        }

        if (!sql) return null;

        return {
            sql: token.isNegative ? `NOT (${sql})` : sql,
            params: [param],
            isPositivePrompt: false
        };
    }

    return {
        sql: token.isNegative ? `positive_prompt NOT LIKE ?` : `positive_prompt LIKE ?`,
        params: [`%${token.term}%`],
        isPositivePrompt: !token.isNegative
    };
};

const appendSearchCondition = (
    conditions: string[],
    params: SqlParam[],
    condition: SearchCondition
) => {
    conditions.push(condition.sql);
    params.push(...condition.params);
};

const appendSearchQueryConditions = (
    query: string,
    conditions: string[],
    params: SqlParam[]
) => {
    const tokens = tokenizeSearchQuery(query);
    let index = 0;

    while (index < tokens.length) {
        const token = tokens[index];
        if (token.isOrOperator) {
            index += 1;
            continue;
        }

        const condition = parseSearchToken(token);
        if (!condition) {
            index += 1;
            continue;
        }

        if (!condition.isPositivePrompt) {
            appendSearchCondition(conditions, params, condition);
            index += 1;
            continue;
        }

        const promptGroup: SearchCondition[] = [condition];
        let nextIndex = index + 1;

        while (nextIndex + 1 < tokens.length && tokens[nextIndex].isOrOperator) {
            const nextCondition = parseSearchToken(tokens[nextIndex + 1]);
            if (!nextCondition?.isPositivePrompt) break;

            promptGroup.push(nextCondition);
            nextIndex += 2;
        }

        if (promptGroup.length > 1) {
            conditions.push(`(${promptGroup.map(item => item.sql).join(' OR ')})`);
            promptGroup.forEach(item => params.push(...item.params));
        } else {
            appendSearchCondition(conditions, params, condition);
        }

        index = nextIndex;
    }
};

export const buildSqlWhereClause = (
    filters: FilterState,
    privacyEnabled: boolean,
    maskingMode: AppSettings['maskingMode'],
    _maskedKeywords: string[],
    collections?: Collection[],
    isRecursive: boolean = false,
    excludeCategories: string[] = [] // New: Categories to exclude from the WHERE clause (for Disjunctive Faceting)
): { where: string; params: SqlParam[]; collectionId?: string; loraName?: string } => {
    const conditions: string[] = [];
    const params: SqlParam[] = [];

    if (!isRecursive) {
        conditions.push('is_deleted = 0');

        if (!filters.showIntermediates) {
            conditions.push("IFNULL(is_intermediate_gen, 0) = 0");
        }
        if (!filters.showGrids) {
            // Use indexed is_grid_gen column only - no json_extract needed
            conditions.push("IFNULL(is_grid_gen, 0) = 0");
        }
    }

    // 1. Privacy Logic
    if (privacyEnabled && maskingMode === 'hide') {
        conditions.push('privacy_hidden = 0');
    }

    // 2. Collection ID (Hybrid Logic)
    if (filters.collectionId) {
        const col = collections?.find(c => c.id === filters.collectionId);
        const subConditions: string[] = [];

        if (col && col.filters) {
            const effectiveSmartFilters = { ...col.filters };
            if (filters.dateRange !== 'all') {
                effectiveSmartFilters.dateRange = 'all';
            }

            const { where: smartWhere, params: smartParams } = buildSqlWhereClause(
                effectiveSmartFilters,
                false,
                'blur',
                [],
                [],
                true
            );

            if (smartWhere) {
                subConditions.push(`(${smartWhere})`);
                params.push(...smartParams);
            }
        }

        if (subConditions.length > 0) {
            let combined = `(${subConditions.join(' OR ')})`;

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

    // 5. Models (Array)
    if (filters.models.length > 0 && !excludeCategories.includes('models')) {
        const matchMode = filters.matchModes?.models || 'any';
        const modelConditions = filters.models.map(m => {
            if (m === 'Unknown') {
                return `(resolved_model_name IS NULL OR resolved_model_name = '' OR resolved_model_name = 'Unknown')`;
            }
            params.push(m);
            return `resolved_model_name = ? COLLATE NOCASE`;
        });
        conditions.push(`(${modelConditions.join(matchMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // 5. Tools (Array)
    if (filters.tools.length > 0 && !excludeCategories.includes('tools')) {
        const matchMode = filters.matchModes?.tools || 'any';
        const toolConditions = filters.tools.map(t => {
            if (t === 'Unknown') {
                return `(tool = 'Unknown' OR tool IS NULL)`;
            }
            params.push(t);
            return `tool = ? COLLATE NOCASE`;
        });
        conditions.push(`(${toolConditions.join(matchMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // 6. Assets
    // LoRAs
    const loraMode = filters.matchModes?.loras || 'any';
    if (!excludeCategories.includes('loras')) {
        if (filters.loras.length === 1 && loraMode === 'any') {
            // Handled by searchRepo
        } else if (filters.loras.length > 0) {
            const loraConditions = filters.loras.map(l => {
                params.push(l);
                return `EXISTS (SELECT 1 FROM image_loras il WHERE il.image_id = id AND il.lora_name = ? COLLATE NOCASE)`;
            });
            conditions.push(`(${loraConditions.join(loraMode === 'all' ? ' AND ' : ' OR ')})`);
        }
    }

    // Embeddings
    const embMode = filters.matchModes?.embeddings || 'any';
    if (filters.embeddings.length > 0 && !excludeCategories.includes('embeddings')) {
        const embConditions = filters.embeddings.map(e => {
            params.push(e);
            return `EXISTS (SELECT 1 FROM image_embeddings ie WHERE ie.image_id = id AND ie.embedding_name = ? COLLATE NOCASE)`;
        });
        conditions.push(`(${embConditions.join(embMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // Hypernetworks
    const hnMode = filters.matchModes?.hypernetworks || 'any';
    if (filters.hypernetworks.length > 0 && !excludeCategories.includes('hypernetworks')) {
        const hnConditions = filters.hypernetworks.map(h => {
            params.push(h);
            return `EXISTS (SELECT 1 FROM image_hypernetworks ih WHERE ih.image_id = id AND ih.hypernetwork_name = ? COLLATE NOCASE)`;
        });
        conditions.push(`(${hnConditions.join(hnMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // ControlNets
    const cnMode = filters.matchModes?.controlNets || 'any';
    if (filters.controlNets && filters.controlNets.length > 0 && !excludeCategories.includes('controlNets')) {
        const cnConditions = filters.controlNets.map(c => {
            params.push(c);
            return `EXISTS (SELECT 1 FROM image_controlnets cn WHERE cn.image_id = id AND cn.controlnet_name = ? COLLATE NOCASE)`;
        });
        conditions.push(`(${cnConditions.join(cnMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // IP-Adapters
    const ipMode = filters.matchModes?.ipAdapters || 'any';
    if (filters.ipAdapters && filters.ipAdapters.length > 0 && !excludeCategories.includes('ipAdapters')) {
        const ipConditions = filters.ipAdapters.map(i => {
            params.push(i);
            return `EXISTS (SELECT 1 FROM image_ipadapters ip WHERE ip.image_id = id AND ip.ipadapter_name = ? COLLATE NOCASE)`;
        });
        conditions.push(`(${ipConditions.join(ipMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // 7. Search Query (Advanced)
    if (filters.searchQuery) {
        appendSearchQueryConditions(filters.searchQuery, conditions, params);
    }

    // 8. Range Sliders
    if (filters.minSteps !== undefined) {
        conditions.push("steps >= ?");
        params.push(filters.minSteps);
    }
    if (filters.maxSteps !== undefined) {
        conditions.push("steps <= ?");
        params.push(filters.maxSteps);
    }
    if (filters.minCfg !== undefined) {
        conditions.push("cfg >= ?");
        params.push(filters.minCfg);
    }
    if (filters.maxCfg !== undefined) {
        conditions.push("cfg <= ?");
        params.push(filters.maxCfg);
    }

    // 9. Samplers
    if (filters.samplers && filters.samplers.length > 0 && !excludeCategories.includes('samplers')) {
        const samplerConditions = filters.samplers.map(() => {
            return `sampler = ?`;
        });
        filters.samplers.forEach(s => params.push(s.toLowerCase().replace(/[_-]/g, ' ')));
        conditions.push(`(${samplerConditions.join(' OR ')})`);
    }

    // 10. Generation Types
    if (filters.generationTypes && filters.generationTypes.length > 0 && !excludeCategories.includes('generationTypes')) {
        const genTypeConditions = filters.generationTypes.map(() => {
            return `generation_type = ?`;
        });
        filters.generationTypes.forEach(gt => params.push(gt));
        conditions.push(`(${genTypeConditions.join(' OR ')})`);
    }

    // 11. Date Range
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

    const col = collections?.find(c => c.id === filters.collectionId);
    const isManualOnly = filters.collectionId && (!col?.filters);

    const loraModeCheck = filters.matchModes?.loras || 'any';
    const loraExcluded = excludeCategories.includes('loras');
    const singleLoraName = (!loraExcluded && filters.loras.length === 1 && loraModeCheck === 'any') ? filters.loras[0] : undefined;

    return {
        where,
        params,
        collectionId: isManualOnly ? filters.collectionId ?? undefined : undefined,
        loraName: singleLoraName
    };
};
