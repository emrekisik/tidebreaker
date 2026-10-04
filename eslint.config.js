import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Zero-allocation rules for hot paths (GAME_DESIGN.md §11.3, CLAUDE.md rule 4).
const hotPathRules = {
  'no-restricted-properties': [
    'error',
    ...['map', 'filter', 'forEach', 'reduce', 'concat', 'slice'].map((property) => ({
      property,
      message:
        'Allocating/iterating array method is forbidden in hot paths. Use indexed loops and preallocated buffers.',
    })),
  ],
  'no-restricted-syntax': [
    'error',
    { selector: 'SpreadElement', message: 'Spread allocates. Not allowed in hot paths.' },
    {
      selector: 'ObjectExpression',
      message: 'Object literals allocate. Use pools / out-parameters.',
    },
    {
      selector: 'ArrayExpression',
      message: 'Array literals allocate. Use typed arrays / preallocated buffers.',
    },
    {
      selector: 'ArrowFunctionExpression',
      message: 'Closures allocate. Not allowed in hot paths.',
    },
    { selector: 'FunctionExpression', message: 'Closures allocate. Not allowed in hot paths.' },
    {
      selector: 'NewExpression[callee.name=/^(Map|Set|WeakMap|WeakSet)$/]',
      message: 'Do not create Map/Set in hot paths.',
    },
    {
      selector: 'TemplateLiteral',
      message: 'String building allocates. Not allowed in hot paths.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/server/src/sim/hot/**/*.ts', 'apps/client/src/**/frame/**/*.ts'],
    rules: hotPathRules,
  },
);
