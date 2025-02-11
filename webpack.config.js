//@ts-check

'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

//@type {import('webpack').Configuration}
const extensionConfig = {
    target: 'node',
    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2'
    },
    devtool: 'source-map',
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
    }
};

const webviewConfig = {
    target: 'web',
    entry: './media/main.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'media/main.js',
        libraryTarget: 'window'
    },
    devtool: 'source-map',
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
        new CopyPlugin({
            patterns: [
                {
                    from: 'node_modules/@vscode/codicons/dist/codicon.css',
                    to: 'media'
                },
                {
                    from: 'node_modules/@vscode/codicons/dist/codicon.ttf',
                    to: 'media'
                },
                {
                    from: 'media/main.css',
                    to: 'media'
                }
            ]
        })
    ]
};

module.exports = [extensionConfig, webviewConfig]; 