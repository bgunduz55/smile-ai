//@ts-check

'use strict';

const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    target: 'node',
    mode: 'none',
    entry: {
        extension: './src/extension.ts',
        'webview/media/settings': './src/webview/media/settings.ts',
        'webview/media/chat': './src/webview/media/chat.ts',
        'webview/media/main': './src/webview/media/main.ts'
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: 'commonjs2'
    },
    devtool: 'nosources-source-map',
    externals: {
        vscode: 'commonjs vscode'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader'
                    }
                ]
            }
        ]
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'media',
                    to: 'media',
                    globOptions: {
                        ignore: ['**/*.ts']
                    }
                },
                {
                    from: 'node_modules/@vscode/codicons/dist',
                    to: 'media/codicons'
                },
                {
                    from: 'resources/smile.svg',
                    to: '.'
                }
            ]
        })
    ],
    infrastructureLogging: {
        level: "log",
    }
}; 