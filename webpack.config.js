//@ts-check

'use strict';

const path = require('path');

//@type {import('webpack').Configuration}
module.exports = {
    mode: 'none', // development modunda deneyelim
    target: 'node',
    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2'
    },
    devtool: 'nosources-source-map',
    externals: {
        vscode: 'commonjs vscode',
        '@vscode/codicons': 'commonjs @vscode/codicons'
    },
    resolve: {
        extensions: ['.ts', '.js'],
        mainFields: ['main', 'module']
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
                            configFile: 'tsconfig.json',
                            transpileOnly: true
                        }
                    }
                ]
            }
        ]
    },
    optimization: {
        minimize: false
    }
}; 