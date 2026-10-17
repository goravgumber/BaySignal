/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          cyan: '#2563EB',
          green: '#16A34A',
          amber: '#D97706',
          red: '#DC2626',
          violet: '#7C3AED'
        },
        dark: {
          base: '#050B18',
          surface: '#0A1628',
          elevated: '#0F2040',
          border: '#1A3050'
        }
      },
      fontFamily: {
        orbitron: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out'
      },
      keyframes: {
        pulseGlow: {
          '0%,100%': { boxShadow: '0 0 5px #00E5FF' },
          '50%': { boxShadow: '0 0 25px #00E5FF, 0 0 50px #00E5FF33' }
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' }
        },
        slideUp: {
          from: { transform: 'translateY(10px)', opacity: 0 },
          to: { transform: 'translateY(0)', opacity: 1 }
        },
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 }
        }
      }
    }
  },
  plugins: []
}
