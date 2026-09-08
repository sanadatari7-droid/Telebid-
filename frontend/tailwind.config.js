export default {
  content: ["./index.html","./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
           50: "#eef2f7",
          100: "#dce4ee",
          200: "#b3c3d6",
          300: "#7f9cbb",
          400: "#4d729d",
          500: "#2c5480",
          600: "#1e3a5f",
          700: "#17304f",
          800: "#0f2540",
          900: "#0a1a30",
        },
        gold: {
          400: "#d1a24f",
          500: "#a5760e",
          600: "#8a610b",
        },
        slate: {
          50: "#f8fafc",
        }
      },
      fontFamily: {
        sans: ["Public Sans","system-ui","-apple-system","sans-serif"],
        display: ["Fraunces","Georgia","serif"],
        mono: ["JetBrains Mono","Fira Code","monospace"],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        "card": "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
        "modal": "0 25px 50px rgba(0,0,0,0.15)",
      },
      animation: {
        "in": "slideIn 0.2s ease-out",
        "fade-in": "fadeIn 0.15s ease-out",
      },
      keyframes: {
        slideIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
}
