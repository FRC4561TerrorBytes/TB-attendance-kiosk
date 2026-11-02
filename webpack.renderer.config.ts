import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

const rendererRules = rules.filter((rule) => {
  if (typeof rule !== "object" || rule === null || !("test" in rule)) {
    return true;
  }
  const { test } = rule as { test?: unknown };
  if (!(test instanceof RegExp)) {
    return true;
  }
  return !test.source.includes("native_modules") && !test.source.includes("node_modules");
});

rendererRules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

export const rendererConfig: Configuration = {
  module: {
    rules: rendererRules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
  },
};
