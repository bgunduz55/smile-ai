const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  target: 'node',
  mode: 'production',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode',
    // Common Node.js modules that should be kept external
    fs: 'commonjs fs',
    path: 'commonjs path',
    os: 'commonjs os',
    child_process: 'commonjs child_process',
    crypto: 'commonjs crypto'
    // External npm dependencies are removed from here to be bundled with the extension
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      path: false,
      fs: false
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                module: 'commonjs'
              }
            }
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  node: {
    __dirname: false,
    __filename: false
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          ecma: 2020,
          compress: {
            drop_console: false, // Keep console logs for debugging
            dead_code: true,
            drop_debugger: true,
            unused: true
          },
          mangle: true,
          output: {
            comments: false
          },
          keep_classnames: true,
          keep_fnames: true
        }
      })
    ]
  },
  stats: {
    optimizationBailout: true // Show why chunks weren't merged
  }
}; 