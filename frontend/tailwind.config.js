/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme');
const { buildTailwindPrimaryColors } = require('./resources/colors');

module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      rotate: {
        '90': '90deg',
        '-90': '-90deg'
      },
      direction: ['ltr', 'rtl'],
      writingMode: {
        vertical: 'vertical-lr',
      },
      colors: {
        primary: buildTailwindPrimaryColors(),
      },
      fontFamily: {
        sans: ['"Jost"', ...defaultTheme.fontFamily.sans],
        mono: ['"Roboto Mono"', ...defaultTheme.fontFamily.mono],
      },
    },
  },
};
