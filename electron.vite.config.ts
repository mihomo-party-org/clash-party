import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// https://github.com/vdesjs/vite-plugin-monaco-editor/issues/21#issuecomment-1827562674
import monacoEditorPluginModule from 'vite-plugin-monaco-editor'
const isObjectWithDefaultFunction = (
  module: unknown
): module is { default: typeof monacoEditorPluginModule } =>
  module != null &&
  typeof module === 'object' &&
  'default' in module &&
  typeof module.default === 'function'
const monacoEditorPlugin = isObjectWithDefaultFunction(monacoEditorPluginModule)
  ? monacoEditorPluginModule.default
  : monacoEditorPluginModule

// Win7 build: bundle all deps (Vite converts ESM→CJS), only externalize native modules
const isLegacyBuild = process.env.LEGACY_BUILD === 'true'
const legacyExternal = ['sysproxy-rs', 'electron', 'utf-8-validate', 'bufferutil']

export default defineConfig({
  main: {
    plugins: isLegacyBuild ? [] : [externalizeDepsPlugin()],
    build: isLegacyBuild
      ? { rollupOptions: { external: legacyExternal, output: { format: 'cjs' } } }
      : undefined
  },
  preload: {
    plugins: isLegacyBuild ? [] : [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: isLegacyBuild ? legacyExternal : undefined,
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          floating: resolve('src/renderer/floating.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      monacoEditorPlugin({
        languageWorkers: ['editorWorkerService', 'typescript', 'css'],
        customDistPath: (_, out) => `${out}/monacoeditorwork`,
        customWorkers: [
          {
            label: 'yaml',
            entry: 'monaco-yaml/yaml.worker'
          }
        ]
      })
    ]
  }
})
