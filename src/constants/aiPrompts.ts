export const AI_PROMPTS = {
    ANALYSIS: `
      You are an expert AI Image Generation Prompt Engineer.
      Analyze the following prompt used for an image generation:
      
      "{{prompt}}"
      
      Provide 3 specific improvements or variations to enhance the visual quality or change the style slightly.
      
      At the end, provide exactly ONE "Applied Example" that combines these improvements into a single, high-quality prompt.
      
      Format the output using Markdown. Use "### Analysis" for the list and "### Applied Example" for the example.
      Keep it professional and concise.
    `,

    VARIATIONS: `Take the following image generation prompt and create 3 distinct variations of it.
            
            Original Prompt: "{{prompt}}"
            
            Variation 1: Artistic/Stylized (Change the art medium or style significantly).
            Variation 2: Cinematic/Realistic (Focus on lighting, photography, and realism).
            Variation 3: Creative Twist (Keep the subject but change the setting or mood).
            
            Return ONLY a JSON array of strings. Do not include markdown formatting.`,

    TITLE: `Generate a short, 3-5 word artistic title for an image generated with this prompt: "{{prompt}}". Return ONLY the title, no quotes.`,

    FILTERS: `Translate this user search query into a JSON filter object for an image library: "{{query}}".
            
            Available tools (enums): ComfyUI, Automatic1111, Midjourney, InvokeAI.
            Available models (strings): SDXL 1.0, Stable Diffusion 1.5, Flux.1, Pony Diffusion V6.
            Date ranges: 'today', 'week', 'month', 'all'.
            
            CRITICAL INSTRUCTIONS:
            1. 'searchQuery': Extract ONLY the key subject matter keywords. Remove conversational phrases like "show me", "find", "images of", "pictures from", "look for". 
               Example: "Show me cyberpunk cities" -> searchQuery: "cyberpunk cities".
               Example: "Find images from yesterday" -> searchQuery: "".
            2. 'dateRange': If the user mentions "yesterday", "last 24 hours", or "today", set dateRange to 'today'. "Last 7 days" -> 'week'.
            3. 'favoritesOnly': Set to true if "favorites", "liked", or "best" is mentioned.
            4. 'tools'/'models': Match loosely.
            `,

    RECOVERY_GENERIC: `Analyze this image. {{stylePrompt}}
    
    IMPORTANT: 
    1. Do NOT guess technical parameters (CFG, Steps, Seed) as they are impossible to know from visual inspection. Return 0 for them.
    2. Do NOT guess the Model Architecture unless there is clear visual evidence (e.g. text watermark). Default 'model' to "Unknown".
    3. Default 'tool' to "Unknown".
    4. Provide a generic safety 'negativePrompt' (e.g., 'low quality, blurry, watermark').
    
    Return the result as JSON.
    `
} as const;

export const RECOVERY_STYLES = {
    midjourney: "Format the output as a Midjourney v6 prompt. Use --v 6 syntax parameters if applicable. Focus on artistic style, lighting, and composition.",
    sdxl: "Format the output as a Stable Diffusion XL (SDXL) prompt. Use booru tags for key elements if helpful, but prioritize natural language description. Mention art style, artist references, and quality boosters (e.g. 'masterpiece, best quality').",
    danbooru: "Format the output as a list of comma-separated Danbooru tags. Focus on character traits, clothing, background elements, and framing.",
    generic: "Provide a detailed descriptive prompt that would generate this image. Include subject, medium, style, lighting, and color palette."
} as const;

export type AIPromptKey = keyof typeof AI_PROMPTS;
