import yaml from 'yaml'

export const parse = <T = unknown>(content: string): T => {
  const processedContent = content.replace(
    /(^|\{|,)(\s*short-id:\s*)(?!['"]|null\b|Null\b|NULL\b|~)([^"'\s,}\n]+)/gm,
    '$1$2"$3"'
  )
  return (yaml.parse(processedContent, { merge: true }) as T) || ({} as T)
}

export function stringify(content: unknown): string {
  return yaml.stringify(content)
}