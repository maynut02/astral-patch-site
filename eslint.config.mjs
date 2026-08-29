import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    ignores: ['backups/**']
  }
).override('nuxt/vue/rules', {
  rules: {
    'vue/html-indent': ['warn', 2, {
      attribute: 1,
      baseIndent: 1,
      closeBracket: 0,
      alignAttributesVertically: false
    }],
    'vue/max-attributes-per-line': ['warn', {
      singleline: { max: 3 },
      multiline: { max: 1 }
    }],
    'vue/first-attribute-linebreak': ['warn', {
      singleline: 'beside',
      multiline: 'below'
    }],
    'vue/html-closing-bracket-newline': ['warn', {
      singleline: 'never',
      multiline: 'always'
    }]
  }
})
