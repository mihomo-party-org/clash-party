# MCP

在「设置 → MCP」启用服务。默认地址为 `http://127.0.0.1:28765/mcp`，端口和 Token 在该页面配置。客户端使用 Streamable HTTP，并在请求中发送 `Authorization: Bearer <Token>`。

服务默认只读。「允许 MCP 编辑和操作」开启后，默认每次写入或运行操作还需要本机确认；取消或无法显示确认窗口均不执行。确认窗口默认选择取消。

「MCP 操作免确认」（`mcpAutoApprove`）默认关闭，需在应用设置中开启 MCP 和写权限后才能操作该开关。开启后，已获写权限的客户端可直接执行编辑、重载、重启等 MCP 操作。鉴权、参数校验、编辑版本检查、并发限制和执行前的权限/取消复查仍然生效；只开启免确认不能获得写权限。关闭免确认后，后续操作恢复本机确认；尚未执行的免确认操作在执行前检测到此变化会返回 `APPROVAL_REQUIRED`。已经显示的确认窗口仍以本次用户选择为准。Agent 配置导入的本机确认不受此开关影响。

客户端参数、工具 annotations 或 `confirm=true` 都不能开启写权限或免确认。`get_state.permissions.localConfirmationRequired` 返回当前是否需要本机确认，写工具描述也会说明此策略。

此接口面向原生 MCP 客户端，只监听 IPv4 loopback，检查 Host，并拒绝含 Origin 的浏览器请求。Token 不能代替应用内的写权限和确认策略；拥有 Token 的客户端可以读取下述公开状态，也可以使用应用中已经保存的测速地址进行测速。

## Agent 一键导入

在「设置 → MCP → 一键导入 Agent」选择客户端。导入前会先保存当前端口和 Token；必须已启用 MCP。

| 客户端      | 导入方式                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor      | 调用原生 `cursor://…/mcp/install` 协议，在 Cursor 确认安装                                                                                   |
| VS Code     | 调用原生 `vscode:mcp/install` 协议，在 VS Code 确认安装                                                                                      |
| Claude Code | 本机确认后，在 `~/.claude.json` 的 `mcpServers.clash-party` 添加或替换 HTTP 服务；设置了 `CLAUDE_CONFIG_DIR` 时使用该目录下的 `.claude.json` |
| Codex       | 本机确认后，在 `~/.codex/config.toml` 的 `mcp_servers.clash-party` 添加或替换 HTTP 服务；设置了 `CODEX_HOME` 时使用该目录下的 `config.toml`  |

配置只包含本机 MCP 地址和 Bearer 鉴权头，不会开启 MCP 写权限。导入接口仅接受上述客户端标识，不接受自定义链接、命令、路径或配置内容，也不会作为 MCP 工具暴露。Cursor / VS Code 的安装链接直接交给本机协议处理程序，不经过网页跳转；需预先安装客户端并注册其协议处理程序。Token 随安装配置交给所选客户端，请只导入可信客户端。

Claude Code / Codex 导入会保留其他配置；Codex 使用 TOML AST 定位编辑，保留其他部分的注释和格式。目标 `clash-party` 项会整体替换，旧的命令、环境变量、鉴权和禁用设置不会残留。文件导入会显示路径并要求本机确认，默认取消。配置损坏、结构不支持、文件链接、超过 8 MiB、权限不足及检测到的并发修改均会返回明确错误。写入使用同目录临时文件和原子发布，新文件及更新后的文件使用 `0600` 权限（Windows 使用系统 ACL）。

导入前请关闭 Codex / Claude Code，完成后重新启动；其他进程在最终检查与原子替换之间的写入仍无法完全排除。更换 MCP 端口或 Token 后需重新导入。导入的客户端须在同一台电脑上运行，远程或云端 Agent 无法通过自身的 `127.0.0.1` 访问此服务。

实现格式参考：[Cursor 安装链接](https://cursor.com/docs/mcp/install-links)、[VS Code MCP 开发文档](https://code.visualstudio.com/api/extension-guides/ai/mcp)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)、[Claude Code 配置目录](https://code.claude.com/docs/en/claude-directory)、[Codex MCP 配置](https://developers.openai.com/codex/mcp/)。

## 工具

工具通过标准 `tools/list` 自描述。参数是具名字段，额外字段会被拒绝。

| 工具                                      | 用途                                       |
| ----------------------------------------- | ------------------------------------------ |
| `get_state`                               | 应用/内核状态、当前配置摘要及写权限        |
| `list_profiles`                           | 配置元数据及编辑所需的 `revision`          |
| `get_core_version`                        | 正在运行的 Mihomo 版本                     |
| `list_proxy_groups`、`list_group_members` | 策略组、成员和当前选择                     |
| `list_rules`、`list_providers`            | 运行时规则及集合摘要                       |
| `test_proxy_delay`                        | 已有组成员测速，仅使用应用保存的测试地址   |
| `select_profile`、`update_profile`        | 切换已有配置、刷新已有远程订阅             |
| `select_proxy`、`reset_proxy_selection`   | 选择组内成员、取消固定选择                 |
| `set_proxy_mode`、`set_rule_enabled`      | 设置有限枚举的代理模式、启停已有运行时规则 |
| `update_provider`、`close_connections`    | 更新已有集合、关闭全部或指定组连接         |
| `reload_config`、`restart_core`           | 重载保存的配置、重启内核                   |
| `edit_profile`                            | 编辑配置名称及有限的订阅更新选项           |
| `get_local_node`、`edit_local_node`       | 读取节点摘要，编辑已有本地节点             |
| `get_local_group`、`edit_local_group`     | 读取并编辑已有本地策略组                   |
| `list_local_rules`、`edit_local_rule`     | 读取本地规则，增删改单条结构化规则         |

列表工具使用 `offset` 和 `limit`，默认每页 50 条，最多 200 条。返回 `items`、`total` 和 `nextOffset`；本地规则列表还包含编辑版本和可用出站。

## 编辑

1. 读取目标，取得 `revision`。
2. 用同一个目标和 `revision` 调用编辑工具。
3. 在应用窗口核对操作、目标和变更并确认。
4. 如返回 `CONFLICT`，重新读取并核对新内容，使用新版本重试。不能自动覆盖冲突。

运行时 `set_rule_enabled` 同样要求 `list_rules` 返回的 `revision`。版本包含当前配置 ID 和规则内容，不包含实时命中计数；确认窗口显示具体规则，规则或配置变化会阻止执行。

本地工具要求明确的 `profileId`，且该配置必须为当前本地配置。版本与配置 ID 绑定；切换配置后不能把旧版本用于另一个配置。实际文件写入也绑定该 ID，避免校验期间的界面切换把数据写到另一份配置。

订阅元数据的版本核对与写入位于同一个应用写队列。节点、组和规则还使用已有编辑服务的乐观锁，经过编译和 Mihomo 配置校验后提交；校验失败不发布。已有应用逻辑负责应用失败后的恢复，恢复失败会单独报告。

`revision` 是进程内随机密钥生成的 HMAC，包含完整目标快照；不会返回凭据的直接哈希。应用重启后需重新读取版本。

| 编辑工具           | 允许的变更                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `edit_profile`     | `name`、`autoUpdate`、整数分钟 `interval`（1–35791）、`useProxy`、秒数 `updateTimeout`（1–300）；本地/插件配置只可改名 |
| `edit_local_node`  | `name`、`server`、`port`、`udp`、`password`、`uuid` 中该协议支持的字段；读取结果的 `editableFields` 提示支持范围       |
| `edit_local_group` | `name`、`hidden`、已有出站组成的 `proxies`；禁止重复成员、自引用，编译器继续检查间接循环                               |
| `edit_local_rule`  | `action` 为 `add`/`edit`/`remove`，加上 `index`；添加/修改使用结构化的 `rule.type`、`payload`、`target`、`noResolve`   |

示例参数：

```json
{
  "profileId": "remote-profile-id",
  "revision": "<list_profiles 返回的 revision>",
  "patch": { "name": "我的订阅", "autoUpdate": true, "interval": 120 }
}
```

节点的 `password` 和 `uuid` 字段允许写入但不回显，确认详情隐藏凭据。原有其他节点字段保留。组/节点改名沿用应用的引用更新逻辑。

本接口不提供通用函数调用、任意配置 patch、原始 YAML/JS、文件路径读写、覆写脚本修改、任意 URL 抓取、应用提权或安装功能。需要这些能力时在应用内操作。旧版 `call(method, args)`、`list_capabilities` 和 capabilities resource 已移除，旧客户端需刷新工具列表。

## 结果与错误

成功结果同时提供文本和 `structuredContent.result`。无返回值的操作返回 `{ "success": true }`。整个结果限制为 1 MiB；超过时返回错误，不单独截断文本而保留完整的结构化敏感数据。

工具错误使用 `isError: true`，文本包含错误码，并返回：

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "The target changed. Read it again and use the new revision."
  }
}
```

| 错误码                                            | 处理方式                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `READ_ONLY`                                       | 在应用设置中开启写权限                                                          |
| `USER_DENIED`、`APPROVAL_UNAVAILABLE`             | 用户拒绝或无法显示本机确认；不执行                                              |
| `APPROVAL_REQUIRED`                               | 执行前免确认已被关闭，重试并在应用内确认                                        |
| `UNAUTHORIZED`                                    | 服务关闭或 Token 已变化，重新连接                                               |
| `BUSY`                                            | 另一个 MCP 操作正在确认/执行，等待完成                                          |
| `CANCELLED`                                       | 确认后、执行前发现请求已取消/断开，不执行；已经开始的应用操作按原有事务流程完成 |
| `CONFLICT`                                        | 状态变化，重新读取目标版本                                                      |
| `NOT_FOUND`、`INVALID_ARGUMENT`、`DUPLICATE_NAME` | 重新检查目标、参数或名称                                                        |
| `VALIDATION_FAILED`                               | 配置编译或内核校验失败，不发布                                                  |
| `APPLY_FAILED_ROLLED_BACK`、`ROLLBACK_FAILED`     | 应用失败，分别表示已恢复或恢复失败                                              |
| `TIMEOUT`、`NETWORK_ERROR`、`CORE_UNAVAILABLE`    | 检查网络或内核运行状态                                                          |
| `UPSTREAM_AUTH_FAILED`、`PERMISSION_DENIED`       | 检查应用内保存的上游凭据或本机权限                                              |
| `RESULT_TOO_LARGE`                                | 减少列表分页大小                                                                |
| `BACKEND_ERROR`                                   | 应用端未分类失败，检查应用状态后再试                                            |

schema 校验失败由 MCP SDK 返回参数错误，不会进入本机确认或业务操作。HTTP 层分别返回 401/403（鉴权/来源）、404/405（路径/方法）、400/413/415（请求体）、429（并发上限）等状态。

MCP 错误和审计日志不会直接输出后端异常对象、请求参数、订阅 URL、节点凭据或文件路径；审计记录工具名、成功与失败码。

## 安全验证

`src/main/mcp/protocol.test.ts` 使用内存传输和真实 loopback HTTP 传输的官方 SDK 客户端，覆盖工具发现、参数校验、来源检查、权限撤回、确认/取消、并发限制、编辑版本冲突、凭据不回显和错误分类。业务依赖及本机确认窗口在该测试中 mock。

`src/main/local/store.test.ts` 使用临时目录和真实 YAML 编译/文件写入，覆盖配置作用域隔离、界面切换期间写入目标固定、失败校验不发布及运行时重载退出编辑作用域。内核校验和重载在该测试中 mock。

`src/main/mcp/agents.test.ts` 使用临时目录和真实 JSON/TOML 编辑，覆盖导入链接编码、客户端白名单、鉴权配置、配置保留、损坏/链接/大文件拒绝、确认取消、设置撤回、并发冲突及文件权限。协议启动器和本机确认窗口在测试中 mock，不会导入开发者正在使用的 Agent。

这些自动检查不代替实际 Electron 确认窗口、真实运行内核和第三方 MCP 客户端的人工验收。
