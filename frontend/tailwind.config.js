export default {
  content: ["./index.html","./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
           50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        gold: {
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
        },
        slate: {
          50: "#f8fafc",
        }
      },
      fontFamily: {
        sans: ["Inter","system-ui","-apple-system","sans-serif"],
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
