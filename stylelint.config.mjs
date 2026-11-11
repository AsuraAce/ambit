// Colours and font families live only in the token file, tailwind.config.js (see
// docs/design-system.md). Stylesheets reference them through Tailwind utilities,
// `@apply` or the custom properties that file declares, never as raw values.
// The token file is JavaScript, so Stylelint never reads it and needs no exemption.
/** @type {import('stylelint').Config} */
export default {
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
    'declaration-property-value-disallowed-list': {
      // Allow only token references and CSS-wide keywords.
      'font-family': ['/^(?!\\s*(var\\(|inherit$|initial$|unset$|revert$)).+/'],
      // The shorthand carries a family too, so it must reference a token as well.
      font: ['/^(?!.*var\\(|\\s*(inherit|initial|unset|revert)$).+/'],
    },
  },
};
