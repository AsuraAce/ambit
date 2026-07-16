export type SearchOperatorCategory = 'content' | 'resource' | 'parameter' | 'date' | 'dimension';

export interface SearchOperatorDefinition {
    example: string;
    description: string;
    category: SearchOperatorCategory;
    suggestions: readonly string[];
}

export const SEARCH_OPERATOR_DEFINITIONS = [
    {
        example: 'sunset',
        description: 'Search the positive prompt (default)',
        category: 'content',
        suggestions: [],
    },
    {
        example: '"dark forest"',
        description: 'Match an exact prompt phrase',
        category: 'content',
        suggestions: [],
    },
    {
        example: 'forest OR ocean',
        description: 'Match either adjacent prompt term',
        category: 'content',
        suggestions: ['OR'],
    },
    {
        example: '-blurry',
        description: 'Exclude a positive-prompt term; !blurry is also supported',
        category: 'content',
        suggestions: [],
    },
    {
        example: 'neg:blur',
        description: 'Search the negative prompt; negative: is also supported',
        category: 'content',
        suggestions: ['neg:', 'negative:'],
    },
    {
        example: 'file:portrait',
        description: 'Search file paths; filename: and path: are also supported',
        category: 'content',
        suggestions: ['file:', 'filename:', 'path:'],
    },
    {
        example: 'all:anime',
        description: 'Search paths and raw metadata (legacy)',
        category: 'content',
        suggestions: ['all:'],
    },
    {
        example: 'model:sdxl',
        description: 'Filter by model',
        category: 'resource',
        suggestions: ['model:'],
    },
    {
        example: 'lora:detail',
        description: 'Filter by LoRA',
        category: 'resource',
        suggestions: ['lora:'],
    },
    {
        example: 'cn:pose',
        description: 'Filter by ControlNet; controlnet: is also supported',
        category: 'resource',
        suggestions: ['cn:', 'controlnet:'],
    },
    {
        example: 'ip:adapter',
        description: 'Filter by IP-Adapter; ipadapter: is also supported',
        category: 'resource',
        suggestions: ['ip:', 'ipadapter:'],
    },
    {
        example: 'tool:invoke',
        description: 'Filter by generator',
        category: 'resource',
        suggestions: ['tool:'],
    },
    {
        example: 'sampler:euler',
        description: 'Filter by sampler',
        category: 'resource',
        suggestions: ['sampler:'],
    },
    {
        example: 'steps:>30',
        description: 'Filter generation steps with a number, <, or >',
        category: 'parameter',
        suggestions: ['steps:'],
    },
    {
        example: 'cfg:<7',
        description: 'Filter CFG with a number, <, or >',
        category: 'parameter',
        suggestions: ['cfg:'],
    },
    {
        example: 'seed:12345',
        description: 'Search seed values',
        category: 'parameter',
        suggestions: ['seed:'],
    },
    {
        example: 'date:2026-04',
        description: 'Filter by year, month, day, or an inclusive range',
        category: 'date',
        suggestions: ['date:'],
    },
    {
        example: 'after:2026-04',
        description: 'Match images from a date onward',
        category: 'date',
        suggestions: ['after:'],
    },
    {
        example: 'before:2025',
        description: 'Match images through a date',
        category: 'date',
        suggestions: ['before:'],
    },
    {
        example: 'w:>1024',
        description: 'Filter width; width: is also supported',
        category: 'dimension',
        suggestions: ['w:', 'width:'],
    },
    {
        example: 'h:<768',
        description: 'Filter height; height: is also supported',
        category: 'dimension',
        suggestions: ['h:', 'height:'],
    },
    {
        example: 'upscaled:true',
        description: 'Show upscaled or non-upscaled images',
        category: 'dimension',
        suggestions: ['upscaled:'],
    },
] as const satisfies readonly SearchOperatorDefinition[];

export const SEARCH_OPERATOR_SUGGESTIONS = SEARCH_OPERATOR_DEFINITIONS.flatMap(
    definition => definition.suggestions.map(value => ({
        value,
        description: definition.description,
    }))
);
