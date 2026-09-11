// Learn more: https://docs.expo.dev/guides/customizing-metro

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite ships a WebAssembly build for the web target. Metro treats .wasm
// as an asset rather than a module, so it has to be declared here or the web
// bundle cannot resolve it.
config.resolver.assetExts.push('wasm');

module.exports = config;
