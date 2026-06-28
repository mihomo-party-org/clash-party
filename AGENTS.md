# Clash Party (mihomo-party) 工作规范

## 项目概述

基于 Electron + React + TypeScript 的跨平台代理客户端。

## 技术栈

- **框架**: Electron + electron-vite
- **前端**: React 19 + TypeScript + TailwindCSS v4
- **UI 组件库**: @heroui/react
- **动画**: framer-motion
- **路由**: react-router-dom v7
- **构建**: electron-vite + electron-builder
- **包管理**: pnpm

## 目录结构

```
src/
├── main/        # Electron 主进程
├── preload/     # 预加载脚本
├── renderer/    # React 前端
│   ├── src/
│   │   ├── App.tsx
│   │   ├── assets/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── routes/
│   │   └── utils/
│   ├── index.html
│   └── floating.html
└── shared/      # 主进程和渲染进程共享代码
```

## 代码规范

### 格式化 (Prettier)

- 单引号 (`singleQuote: true`)
- 无分号 (`semi: false`)
- 行宽 100 (`printWidth: 100`)
- 无尾逗号 (`trailingComma: none`)
- 缩进 2 空格
- 文件末尾保留空行

### 命名规范

- **文件/目录**: kebab-case (如 `app-config.ts`, `use-theme.ts`)
- **React 组件**: PascalCase (如 `ProxyCard.tsx`)
- **函数/变量**: camelCase
- **常量**: UPPER_SNAKE_CASE
- **类型/接口**: PascalCase，接口名加 `I` 前缀（如 `IProxyConfig`）
- **枚举**: PascalCase

### TypeScript 规范

- 优先使用 `interface` 而非 `type` 定义对象类型
- 禁止使用 `any`，优先 `unknown` 或明确的类型
- 禁止非空断言 (`!`)
- 未使用的变量/参数用 `_` 前缀
- 模块解析使用 `bundler`

### React 规范

- 使用函数组件 + Hooks
- 优先使用 React Router v7 的路由方案
- 使用 TailwindCSS 类名进行样式编写，避免内联 style
- 国际化使用 `react-i18next` + `i18next`
- 状态管理优先使用 SWR (`swr`) 管理服务端状态

### 导入顺序

1. 内置模块
2. 外部依赖
3. 内部模块
4. 父级模块
5. 同级模块
6. 索引文件

### 路径别名

- `@renderer/*` -> `src/renderer/src/*`

## 脚本命令

```bash
pnpm run dev              # 启动开发环境
pnpm run lint             # ESLint 检查并修复
pnpm run lint:check       # ESLint 检查（只报告）
pnpm run format           # Prettier 格式化
pnpm run format:check     # Prettier 检查
pnpm run typecheck        # TypeScript 类型检查
pnpm run review           # 完整检查（format:check + lint:check + typecheck）
pnpm run build:linux      # 构建 Linux 版本
pnpm run build:mac        # 构建 macOS 版本
pnpm run build:win        # 构建 Windows 版本
```

## 工作流程

### 代码修改流程（必须先提案后执行）

1. 当需要修改代码时，必须先**分析问题，给出完整的解决方案**
2. 在方案中明确列出：
   - 要修改哪些文件
   - 修改内容摘要
   - 潜在风险或影响范围
3. **等待我确认后**，才能执行代码修改
4. 修改完成后，运行 `pnpm run lint && pnpm run typecheck` 确保无错误

### Git 提交流程

1. 所有 Git 操作（add、commit、push 等）**必须先询问我**
2. 未经我明确同意，不得执行任何 Git 提交或推送
3. 提交前必须运行 `pnpm run review` 确保全部检查通过

### 通用规则

1. **不要** 修改 `dist/`, `out/`, `extra/` 目录下的文件
2. **不要** 提交配置文件中的密钥和令牌
3. 新功能或修复需要保持向后兼容

## 环境要求

- Node.js >= 20
- pnpm >= 10
- 不要锁定包版本到低版本
