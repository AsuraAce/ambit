import { FilterState, AppSettings, Collection } from '../types';
import { getDateFilterBounds, getSearchDateBounds } from './dateFilters';

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

type AssetAliasFilterKey = 'models' | 'loras' | 'embeddings' | 'hypernetworks' | 'controlNets' | 'ipAdapters';

export const normalizeResourceReferenceForFilter = (value: string): string => {
    const trimmed = value.trim();
    const weightIndex = trimmed.indexOf(' (');
    if (weightIndex > 0) return trimmed.slice(0, weightIndex).trim();

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) return trimmed.slice(0, colonIndex).trim();

    return trimmed;
};

export const resourceReferenceSql = (column: string): string => (
    `CASE
        WHEN instr(${column}, ' (') > 0 THEN trim(substr(${column}, 1, instr(${column}, ' (') - 1))
        WHEN instr(${column}, ':') > 0 THEN trim(substr(${column}, 1, instr(${column}, ':') - 1))
        ELSE trim(${column})
    END`
);

export const resourceReferenceEqualsSql = (column: string): string => (
    `(${resourceReferenceSql(column)}) COLLATE NOCASE = ?`
);

const uniqueValues = (values: string[]): string[] => {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(trimmed);
    }

    return result;
};

const getAssetAliasGroups = (
    filters: FilterState,
    filterKey: AssetAliasFilterKey,
    selectedValues: string[]
): string[][] => selectedValues.map(value => (
    uniqueValues([value, ...(filters.assetFilterAliases?.[filterKey]?.[value] || [])])
));

const getResourceAliasGroups = (
    filters: FilterState,
    filterKey: Exclude<AssetAliasFilterKey, 'models'>,
    selectedValues: string[]
): string[][] => getAssetAliasGroups(filters, filterKey, selectedValues)
    .map(aliases => uniqueValues(aliases.map(normalizeResourceReferenceForFilter)));

const buildAliasGroupCondition = (
    aliases: string[],
    createCondition: (alias: string) => string,
    params: SqlParam[]
): string => {
    const conditions = aliases.map(alias => {
        const condition = createCondition(alias);
        if (condition.includes('?')) {
            params.push(alias);
        }
        return condition;
    });

    return conditions.length === 1 ? conditions[0] : `(${conditions.join(' OR ')})`;
};

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
        const separatorIndex = lowerTerm.indexOf(':');
        const key = lowerTerm.slice(0, separatorIndex);
        const val = lowerTerm.slice(separatorIndex + 1);

        let sql = '';
        let param: SqlParam = val;

        const dateBounds = getSearchDateBounds(key, val);
        if (dateBounds) {
            const dateConditions: string[] = [];
            const dateParams: SqlParam[] = [];

            if (dateBounds.start !== undefined) {
                dateConditions.push('timestamp >= ?');
                dateParams.push(dateBounds.start);
            }
            if (dateBounds.end !== undefined) {
                dateConditions.push('timestamp < ?');
                dateParams.push(dateBounds.end);
            }

            return {
                sql: token.isNegative
                    ? `NOT (${dateConditions.join(' AND ')})`
                    : `(${dateConditions.join(' AND ')})`,
                params: dateParams,
                isPositivePrompt: false
            };
        }

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
            sql = `CAST(seed AS TEXT) LIKE ?`;
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
            const globalDateBounds = getDateFilterBounds(filters);
            if (globalDateBounds.start !== undefined || globalDateBounds.end !== undefined) {
                effectiveSmartFilters.dateRange = 'all';
                effectiveSmartFilters.dateFrom = undefined;
                effectiveSmartFilters.dateTo = undefined;
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
        const modelConditions = getAssetAliasGroups(filters, 'models', filters.models).map(aliases => (
            buildAliasGroupCondition(aliases, alias => {
                if (alias === 'Unknown') {
                    return `(resolved_model_name IS NULL OR resolved_model_name = '' OR resolved_model_name = 'Unknown')`;
                }
                return `resolved_model_name = ? COLLATE NOCASE`;
            }, params)
        ));
        conditions.push(`(${modelConditions.join(' OR ')})`);
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
        const loraAliasGroups = getResourceAliasGroups(filters, 'loras', filters.loras);
        if (filters.loras.length === 1 && loraMode === 'any' && loraAliasGroups[0]?.length === 1) {
            // Handled by searchRepo
        } else if (filters.loras.length > 0) {
            const loraConditions = loraAliasGroups.map(aliases => (
                buildAliasGroupCondition(aliases, () => (
                    `EXISTS (SELECT 1 FROM image_loras il WHERE il.image_id = id AND ${resourceReferenceEqualsSql('il.lora_name')})`
                ), params)
            ));
            conditions.push(`(${loraConditions.join(loraMode === 'all' ? ' AND ' : ' OR ')})`);
        }
    }

    // Embeddings
    const embMode = filters.matchModes?.embeddings || 'any';
    if (filters.embeddings.length > 0 && !excludeCategories.includes('embeddings')) {
        const embConditions = getResourceAliasGroups(filters, 'embeddings', filters.embeddings).map(aliases => (
            buildAliasGroupCondition(aliases, () => (
                `EXISTS (SELECT 1 FROM image_embeddings ie WHERE ie.image_id = id AND ${resourceReferenceEqualsSql('ie.embedding_name')})`
            ), params)
        ));
        conditions.push(`(${embConditions.join(embMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // Hypernetworks
    const hnMode = filters.matchModes?.hypernetworks || 'any';
    if (filters.hypernetworks.length > 0 && !excludeCategories.includes('hypernetworks')) {
        const hnConditions = getResourceAliasGroups(filters, 'hypernetworks', filters.hypernetworks).map(aliases => (
            buildAliasGroupCondition(aliases, () => (
                `EXISTS (SELECT 1 FROM image_hypernetworks ih WHERE ih.image_id = id AND ${resourceReferenceEqualsSql('ih.hypernetwork_name')})`
            ), params)
        ));
        conditions.push(`(${hnConditions.join(hnMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // ControlNets
    const cnMode = filters.matchModes?.controlNets || 'any';
    if (filters.controlNets && filters.controlNets.length > 0 && !excludeCategories.includes('controlNets')) {
        const cnConditions = getResourceAliasGroups(filters, 'controlNets', filters.controlNets).map(aliases => (
            buildAliasGroupCondition(aliases, () => (
                `EXISTS (SELECT 1 FROM image_controlnets cn WHERE cn.image_id = id AND ${resourceReferenceEqualsSql('cn.controlnet_name')})`
            ), params)
        ));
        conditions.push(`(${cnConditions.join(cnMode === 'all' ? ' AND ' : ' OR ')})`);
    }

    // IP-Adapters
    const ipMode = filters.matchModes?.ipAdapters || 'any';
    if (filters.ipAdapters && filters.ipAdapters.length > 0 && !excludeCategories.includes('ipAdapters')) {
        const ipConditions = getResourceAliasGroups(filters, 'ipAdapters', filters.ipAdapters).map(aliases => (
            buildAliasGroupCondition(aliases, () => (
                `EXISTS (SELECT 1 FROM image_ipadapters ip WHERE ip.image_id = id AND ${resourceReferenceEqualsSql('ip.ipadapter_name')})`
            ), params)
        ));
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
    const dateBounds = getDateFilterBounds(filters);
    if (dateBounds.start !== undefined) {
        conditions.push('timestamp >= ?');
        params.push(dateBounds.start);
    }
    if (dateBounds.end !== undefined) {
        conditions.push('timestamp < ?');
        params.push(dateBounds.end);
    }

    const where = conditions.length > 0 ? (isRecursive ? conditions.join(' AND ') : `WHERE ${conditions.join(' AND ')}`) : '';

    const col = collections?.find(c => c.id === filters.collectionId);
    const isManualOnly = filters.collectionId && (!col?.filters);

    const loraModeCheck = filters.matchModes?.loras || 'any';
    const loraExcluded = excludeCategories.includes('loras');
    const singleLoraAliasGroups = getResourceAliasGroups(filters, 'loras', filters.loras);
    const singleLoraName = (!loraExcluded && filters.loras.length === 1 && loraModeCheck === 'any' && singleLoraAliasGroups[0]?.length === 1)
        ? singleLoraAliasGroups[0][0]
        : undefined;

    return {
        where,
        params,
        collectionId: isManualOnly ? filters.collectionId as string : undefined,
        loraName: singleLoraName
    };
};
