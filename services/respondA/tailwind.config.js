/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                "primary": "#0d59f2",
                "background-light": "#F8F9FA",
                "background-dark": "#101622",
                "surface": "#FFFFFF",
                "text-main": "#1A1D20",
                "muted": "#868E96",
                "accent": "#E03131",
                "success": "#089950",
                "border-color": "#DEE2E6",
                "row-hover": "#F1F3F5"
            },
            fontFamily: {
                "heading": ["Space Grotesk", "sans-serif"],
                "body": ["IBM Plex Sans", "sans-serif"],
                "mono": ["IBM Plex Mono", "monospace"]
            },
            borderWidth: {
                'thin': '1px',
            },
            borderRadius: {
                "DEFAULT": "12px",
                "sm": "8px",
                "md": "12px",
                "lg": "16px",
                "xl": "20px",
                "2xl": "24px",
                "3xl": "32px",
                "full": "9999px",
            },
            boxShadow: {
                'none': 'none',
            }
        },
    },
    plugins: [],
}
