/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: ["./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
                jp: ['Noto Sans JP', 'ui-sans-serif', 'system-ui', 'sans-serif']
            },
            colors: {
                sage: {
                    '50': '#f4f7f0',
                    '100': '#e5eddc',
                    '200': '#cddcb9',
                    '300': '#aec490',
                    '400': '#8ca36b',
                    '500': '#738c55',
                    '600': '#53633d',
                    '700': '#465035',
                    '800': '#3a412f',
                    '900': '#313629',
                    '950': '#1a1d15'
                },
                amethyst: {
                    '50': '#f7f7fa',
                    '100': '#ebebf5',
                    '200': '#dcdcf0',
                    '300': '#c4c4e6',
                    '400': '#a3a3d6',
                    '500': '#8282c4',
                    '600': '#6969a8',
                    '700': '#55558a',
                    '800': '#44446e',
                    '900': '#383857',
                    '950': '#232336'
                },
                slate: {
                    '800': '#27272a',
                    '850': '#202023',
                    '900': '#18181b',
                    '950': '#09090b'
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
            },
            transitionTimingFunction: {
                spring: 'cubic-bezier(0.16, 1, 0.3, 1)'
            },
            animation: {
                'spring-enter': 'enter 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                'shimmer': 'shimmer 2s linear infinite'
            },
            keyframes: {
                shimmer: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' }
                }
            }
        },
    },
    plugins: [require("tailwindcss-animate")],
}
