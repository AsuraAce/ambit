/** @type {import('tailwindcss').Config} */
import animate from 'tailwindcss-animate';
import plugin from 'tailwindcss/plugin';

// This file is Ambit's single colour and font token file (see docs/design-system.md).
// Stylesheets and components reference these values; Stylelint rejects raw colours
// and font names anywhere else.

// Custom-property tokens for both themes. Values derived from other custom
// properties are declared in both blocks so they resolve against the active theme.
const themeVariables = plugin(({ addBase }) => {
    addBase({
        ':root': {
            '--background': '0 0% 100%',
            '--foreground': '240 10% 3.9%',
            '--card': '0 0% 100%',
            '--card-foreground': '240 10% 3.9%',
            '--popover': '0 0% 100%',
            '--popover-foreground': '240 10% 3.9%',
            '--primary': '240 5.9% 10%',
            '--primary-foreground': '0 0% 98%',
            '--secondary': '240 4.8% 95.9%',
            '--secondary-foreground': '240 5.9% 10%',
            '--muted': '240 4.8% 95.9%',
            '--muted-foreground': '240 3.8% 46.1%',
            '--accent': '240 4.8% 95.9%',
            '--accent-foreground': '240 5.9% 10%',
            '--destructive': '0 84.2% 60.2%',
            '--destructive-foreground': '0 0% 98%',
            '--border': '240 5.9% 90%',
            '--input': '240 5.9% 90%',
            '--ring': '240 10% 3.9%',
            '--chart-1': '12 76% 61%',
            '--chart-2': '173 58% 39%',
            '--chart-3': '197 37% 24%',
            '--chart-4': '43 74% 66%',
            '--chart-5': '27 87% 67%',
            '--radius': '0.5rem',
            '--scrollbar-thumb': 'rgb(209 213 219)',
            '--scrollbar-thumb-hover': 'rgb(156 163 175)',
            '--scrollbar-thumb-dark': 'rgb(255 255 255 / 0.1)',
            '--scrollbar-thumb-dark-hover': 'rgb(255 255 255 / 0.2)',
            '--custom-scrollbar-color': 'hsl(var(--muted-foreground) / 0.3)',
            '--custom-scrollbar-thumb': 'hsl(var(--muted-foreground) / 0.2)',
            '--custom-scrollbar-thumb-hover': 'hsl(var(--muted-foreground) / 0.5)',
            '--error-fallback-surface': 'rgba(255,0,0,0.1)',
            '--error-fallback-border': 'red',
            '--error-fallback-text': '#ff4444',
            '--error-fallback-button': '#444',
            '--error-fallback-button-text': 'white',
        },
        '.dark': {
            '--background': '240 10% 3.9%',
            '--foreground': '0 0% 98%',
            '--card': '240 10% 3.9%',
            '--card-foreground': '0 0% 98%',
            '--popover': '240 10% 3.9%',
            '--popover-foreground': '0 0% 98%',
            '--primary': '0 0% 98%',
            '--primary-foreground': '240 5.9% 10%',
            '--secondary': '240 3.7% 15.9%',
            '--secondary-foreground': '0 0% 98%',
            '--muted': '240 3.7% 15.9%',
            '--muted-foreground': '240 5% 64.9%',
            '--accent': '240 3.7% 15.9%',
            '--accent-foreground': '0 0% 98%',
            '--destructive': '0 62.8% 30.6%',
            '--destructive-foreground': '0 0% 98%',
            '--border': '240 3.7% 15.9%',
            '--input': '240 3.7% 15.9%',
            '--ring': '240 4.9% 83.9%',
            '--chart-1': '220 70% 50%',
            '--chart-2': '160 60% 45%',
            '--chart-3': '30 80% 55%',
            '--chart-4': '280 65% 60%',
            '--chart-5': '340 75% 55%',
            '--custom-scrollbar-color': 'hsl(var(--muted-foreground) / 0.3)',
            '--custom-scrollbar-thumb': 'hsl(var(--muted-foreground) / 0.2)',
            '--custom-scrollbar-thumb-hover': 'hsl(var(--muted-foreground) / 0.5)',
        },
    });
});

export default {
    darkMode: ['class'],
    content: ['./src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
                jp: ['Noto Sans JP', 'ui-sans-serif', 'system-ui', 'sans-serif'],
            },
            colors: {
                sage: {
                    50: '#f4f7f0',
                    100: '#e5eddc',
                    200: '#cddcb9',
                    300: '#aec490',
                    400: '#8ca36b',
                    500: '#738c55',
                    600: '#53633d',
                    700: '#465035',
                    800: '#3a412f',
                    900: '#313629',
                    950: '#1a1d15',
                },
                amethyst: {
                    50: '#f7f7fa',
                    100: '#ebebf5',
                    200: '#dcdcf0',
                    300: '#c4c4e6',
                    400: '#a3a3d6',
                    500: '#8282c4',
                    600: '#6969a8',
                    700: '#55558a',
                    800: '#44446e',
                    900: '#383857',
                    950: '#232336',
                },
                harbor: {
                    50: '#f5f7f8',
                    100: '#e7edf0',
                    200: '#cfdae0',
                    300: '#adbec8',
                    400: '#849daa',
                    500: '#687f8c',
                    600: '#536874',
                    700: '#465760',
                    800: '#3b484f',
                    900: '#333d42',
                    950: '#1b2226',
                },
                ember: {
                    50: '#f8f6f1',
                    100: '#eee8dc',
                    200: '#ded1ba',
                    300: '#c7b18d',
                    400: '#a98d64',
                    500: '#8c704d',
                    600: '#70583e',
                    700: '#5b4937',
                    800: '#4b3d31',
                    900: '#40352c',
                    950: '#241d18',
                },
                slate: {
                    800: '#27272a',
                    850: '#202023',
                    900: '#18181b',
                    950: '#09090b',
                },
                // Near-black dark-theme surfaces for modals and the media canvas.
                surface: {
                    modal: '#0c0c0e',
                    dialog: '#0a0a0c',
                    shelf: '#111',
                    panel: '#0a0a0a',
                    canvas: '#050505',
                },
                // Third-party brand colour for the Ko-fi donation button.
                kofi: {
                    DEFAULT: '#FF5E5B',
                    hover: '#ff4845',
                },
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))',
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover))',
                    foreground: 'hsl(var(--popover-foreground))',
                },
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))',
                },
            },
            transitionTimingFunction: {
                spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
            },
            animation: {
                'spring-enter': 'enter 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                shimmer: 'shimmer 2s linear infinite',
            },
            keyframes: {
                shimmer: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
            },
        },
    },
    plugins: [animate, themeVariables],
};
