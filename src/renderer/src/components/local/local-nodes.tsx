import { Card, CardBody } from '@heroui/react'
import { toast } from '@renderer/components/base/toast'
import { getLocalConfig, removeLocalNode } from '@renderer/utils/ipc'
import { useMemo, useState } from 'react'
import { MdAdd } from 'react-icons/md'
import { parse } from 'yaml'
import useSWR from 'swr'
import type { LocalObject } from '../../../../shared/local-config'
import NodeCard from './node-card'
import NodeModal from './node-modal'

const LocalNodes: React.FC = () => {
  const { data, error, mutate } = useSWR('getLocalConfig', () => getLocalConfig())
  const [editing, setEditing] = useState<string>()
  const [creating, setCreating] = useState(false)
  const nodes = useMemo<LocalObject[]>(() => {
    if (!data) return []
    try {
      const parsed: unknown = parse(data.modules.proxies)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is LocalObject => !!item && typeof item === 'object')
        : []
    } catch {
      return []
    }
  }, [data])
  return (
    <div>
      {error ? (
        <div role="alert" className="px-2 pb-2 text-sm text-danger">
          {String(error)}
        </div>
      ) : null}
      {data && !error && nodes.length === 0 && (
        <div className="px-2 pb-2 text-sm text-foreground-500">
          还没有本地节点，可以粘贴分享链接、Clash 节点或手动填写。
        </div>
      )}
      <div>
        {nodes.map((node) => (
          <div key={String(node.name)} className="px-2 pt-2">
            <NodeCard
              node={node}
              onEdit={() => setEditing(String(node.name))}
              onDelete={async () => {
                await removeLocalNode(String(node.name), node)
                await mutate()
              }}
            />
          </div>
        ))}
        <div className="px-2 pb-2 pt-2">
          <Card isPressable fullWidth isDisabled={!!error} onPress={() => setCreating(true)}>
            <CardBody className="flex h-14 flex-row items-center justify-center gap-2 text-foreground-500">
              <MdAdd className="text-xl" />
              <span className="text-sm">添加节点</span>
            </CardBody>
          </Card>
        </div>
      </div>
      {(creating || editing !== undefined) && (
        <NodeModal
          key={creating ? 'new-node' : `edit:${editing}`}
          name={creating ? undefined : editing}
          onClose={() => {
            setCreating(false)
            setEditing(undefined)
          }}
          onSaved={() => {
            mutate().catch((error) => toast.error(String(error)))
          }}
        />
      )}
    </div>
  )
}

export default LocalNodes
