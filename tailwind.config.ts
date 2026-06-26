import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        focus: {
          navy: "#031322",
          ink: "#061b2d",
          panel: "#082237",
          yellow: "#ffb800",
          gold: "#f5a900",
          line: "rgba(255,184,0,0.38)"
        }
      },
      boxShadow: {
        focus: "0 24px 70px rgba(0,0,0,0.38)"
      },
      fontFamily: {
        display: ["var(--font-display)", "Arial Narrow", "Arial", "sans-serif"],
        sans: ["var(--font-sans)", "Inter", "Arial", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
