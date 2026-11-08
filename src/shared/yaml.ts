import { Scalar, isAlias, isCollection, isPair, isScalar, parse, parseDocument, visit } from 'yaml'

export interface YamlParseOptions {
  maxAliasCount?: number
}

// REALITY 的 short-id 是十六进制串，订阅里常不加引号，YAML 1.2 会把 1234e123、0123 之类猜成数字。
// 只纠正解析器自己猜出的类型：引号、块标量和显式标签都照原样。
function guessedSource(node: unknown): string | undefined {
  if (!isScalar(node) || node.type !== Scalar.PLAIN || node.tag !== undefined) return undefined
  if (node.value === null || typeof node.value === 'string') return undefined
  return node.source
}

/**
 * 等价于 `yaml.parse(content, { merge: true, maxAliasCount })`，
 * 唯一的区别是未加引号的 `short-id` 保留原文字符串。
 */
export function parseYaml(content: string, options?: YamlParseOptions): unknown {
  const maxAliasCount = options?.maxAliasCount
  if (!content.includes('short-id')) return parse(content, { merge: true, maxAliasCount })

  const doc = parseDocument(content, { merge: true })
  // 与 yaml 库的 log.warn 一致：node 里用 process.emitWarning，浏览器里用 console.warn
  for (const warning of doc.warnings) {
    if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
      process.emitWarning(warning)
    } else {
      console.warn(warning)
    }
  }
  if (doc.errors.length > 0) throw doc.errors[0]

  // 先序遍历中每个锚点名最近一次出现的节点，即别名指向的节点
  const anchors = new Map<string, unknown>()
  visit(doc, {
    Node(key, node, path) {
      const pair = path[path.length - 1]
      if (key === 'value' && isPair(pair) && isScalar(pair.key) && pair.key.value === 'short-id') {
        const source = guessedSource(isAlias(node) ? anchors.get(node.source) : node)
        // 别名换成新标量，锚点节点不动：它可能还在别处被引用
        if (source !== undefined && isAlias(node)) return new Scalar(source)
        if (source !== undefined) (node as Scalar).value = source
      }
      if ((isScalar(node) || isCollection(node)) && node.anchor) anchors.set(node.anchor, node)
      return undefined
    }
  })
  return doc.toJS({ maxAliasCount })
}
