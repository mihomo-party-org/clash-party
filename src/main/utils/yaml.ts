import yaml from 'yaml'
import { parseYaml } from '../../shared/yaml'
import type { YamlParseOptions } from '../../shared/yaml'

export type { YamlParseOptions }

export const parse = <T = unknown>(content: string, options?: YamlParseOptions): T => {
  return (parseYaml(content, options) as T) || ({} as T)
}

export function stringify(content: unknown): string {
  return yaml.stringify(content)
}
