import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0f17",
        panel: "#111827",
        edge: "#1f2937",
        accent: "#22d3ee",
        good: "#34d399",
        warn: "#fbbf24",
        bad: "#f87171",
      },
    },
  },
  plugins: [],
};
export default config;
