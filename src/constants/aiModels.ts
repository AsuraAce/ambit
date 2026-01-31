
export interface AIModel {
    id: string;
    name: string;
    description: string;
    isExperimental?: boolean;
}

export const AI_MODELS: AIModel[] = [
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Fast and efficient for most tasks.'
    },
    {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        description: 'The lightest and fastest model for simple tasks.'
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: 'Balanced performance and speed for complex tasks.'
    },
    {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash Preview',
        description: 'Experimental next-gen fast model.',
        isExperimental: true
    },
    {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro Preview',
        description: 'Experimental next-gen powerful model.',
        isExperimental: true
    }
];

export const DEFAULT_AI_MODEL = 'gemini-2.5-flash-lite';
