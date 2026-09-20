# SEEKMORE｜求索无境

**面向 Windows 与 macOS 的开源桌面 AI Agent Harness。**

[English](README.md) · [官网](https://seekmore.ai)

SEEKMORE 把 Agent Runtime、本地工具、Skill、MCP、Memory、Knowledge、运行对象、Workflow、Automation 和外部模型 API 放在一个桌面应用里。


---

## 快速开始

### 环境要求

- Node.js `24.19.0`
- pnpm `10.6.5`
- PostgreSQL + pgvector
- Redis / Valkey 等 RESP-compatible Cache

桌面发行包会携带自己的本地 Runtime；从源码开发时，需要本机或远端已经有 PostgreSQL 与 Cache Service，并在 `backend/.env` 中配置连接信息。

### 1. Clone SEEKMORE

```bash
git clone https://github.com/holyhan00/SEEKMORE.git
cd seekmore
```

### 2. 安装 Workspace 依赖

```bash
corepack enable
pnpm install
```

### 3. 配置 Backend `.env`

当前源码使用 `backend/.env` 作为本地开发配置。

启动 Backend 前，至少确认数据库、缓存、JWT、CORS 和 MCP Secret 等配置：

```dotenv
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5432/<database>

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

JWT_ACCESS_SECRET=<生成一个开发环境 Secret>
JWT_REFRESH_SECRET=<生成另一个不同的 Secret>
JWT_ISSUER=seekmore
JWT_AUDIENCE=seekmore-api
JWT_REFRESH_AUDIENCE=seekmore-refresh
JWT_ACCESS_TTL=15m

CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# 使用加密 MCP Credential 时需要。
# 接受 64 位十六进制或 Base64 编码的 32-byte Key。
MCP_SECRET_ENCRYPTION_KEY=<32-byte-key>
```

本地生成 Secret：

```bash
openssl rand -hex 48   # JWT Secret
openssl rand -hex 32   # MCP AES-256 Key
```

不要把生产环境 Credential 或模型厂商 API Key 提交到仓库。

> 当前源码树自带开发用 `backend/.env`。如果 fork 后公开仓库，更常规的做法是只提交清理过的 `.env.example`，真实 `.env` 保持本地私有。

### 4. 执行 Prisma Migration

```bash
pnpm --filter backend prisma:migrate
```

### 5. 启动 SEEKMORE

从仓库根目录分别打开三个终端：

```bash
pnpm dev:backend
```

```bash
pnpm dev:frontend
```

```bash
pnpm dev:desktop
```

等价的 Workspace 内命令：

```bash
cd backend
pnpm start:dev
```

```bash
cd frontend
pnpm dev
```

```bash
cd desktop
SEEKMORE_RENDERER_DEV_URL=http://127.0.0.1:5173 pnpm dev
```

`SEEKMORE_RENDERER_DEV_URL` 是可选项；Desktop Development Runtime 默认已经使用 `http://127.0.0.1:5173`。

### 6. 设置 LLM

Desktop 打开后：

1. 进入 **Settings → 模型设置**；
2. 选择主模型 Provider 与 Model；
3. 填写对应 API Key 并保存；
4. 按需继续设置 Vision、Image、Video、Audio 和 Web Search Provider。

模型厂商 API Key 走应用内 Model Settings，不放在上面的 Backend Development `.env` 中。

---

## 从源码构建

完整构建全部 Workspace：

```bash
pnpm build
```

根目录 Build 顺序为 Backend → Frontend → Desktop。

---

## macOS 应用构建

macOS Release Flow 需要在 macOS 上执行。

```bash
cd seekmore

pnpm release:vendor:macos
pnpm release:build
pnpm release:stage
pnpm release:verify:stage
pnpm test:release:stage
```

如果 Electron 下载需要使用当前发行流程使用的国内镜像：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

继续执行 App / Installer 打包与验证：

```bash
pnpm release:app:macos
pnpm release:verify:app:macos
pnpm release:installer:macos
pnpm release:verify:installer:macos
pnpm test:release:macos
```

当前 macOS Target 为 Apple Silicon (`arm64`)，最终生成 DMG。Release Pipeline 会分别验证 Stage Runtime、App Bundle、Installer 和 Release Contract。

---

## Windows 应用构建

Windows Release Flow 需要在 Windows 上执行。

### Command Prompt

```bat
cd seekmore

set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

pnpm release:vendor:windows
pnpm release:build
pnpm release:stage
pnpm release:verify:stage
pnpm test:release:stage
pnpm release:app:windows
pnpm release:verify:app:windows
pnpm release:installer:windows
pnpm release:verify:installer:windows
pnpm test:release:windows
```

### PowerShell

```powershell
cd seekmore

$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

pnpm release:vendor:windows
pnpm release:build
pnpm release:stage
pnpm release:verify:stage
pnpm test:release:stage
pnpm release:app:windows
pnpm release:verify:app:windows
pnpm release:installer:windows
pnpm release:verify:installer:windows
pnpm test:release:windows
```

当前 Windows Target 为 `x64`，最终生成 NSIS Installer。

---

## 核心架构

Chat 主执行链：

```text
User Input
   ↓
ChatTurnRequest
   ↓
AgentTurn
   ↓
AgentLoop
   ├── Context
   ├── Memory
   ├── Knowledge
   ├── Skills
   ├── Capability / Access Policy
   └── Tool Runtime
          ├── Built-in Tools
          ├── MCP Tools
          └── External Provider APIs
```

`ChatTurnRequest` 负责 Chat 层调度；`AgentTurn` 是一次 Turn 的持久执行身份；`AgentLoop` 在同一个 Turn 内执行模型调用、Tool、Observation 与后续迭代。

不同 Agent Profile 共享同一套 Runtime，通过模型配置、Knowledge、Skill、Workspace 和权限形成差异。

---

## Durable AgentTurn 与断点恢复

SEEKMORE 不把固定墙钟时间作为 `AgentTurn` 的生命周期。

Model Call 和 Tool Call 各自保留 Timeout；Turn 本身由迭代预算、无进展检测、用户取消、审批状态和真实运行错误约束。

`AgentTurnCheckpoint` 保存可恢复的 Runtime State。Tool 已完整执行并写入 Observation 后会落安全 checkpoint，使已经完成的工作可以从安全边界继续，而不是重新执行一遍。

当前恢复策略保持保守：

- `ready` checkpoint 可以恢复；
- `waiting_user` 可以在用户输入后继续；
- `executing_tools` 不盲目 Replay，因为外部 Side Effect 可能已经发生；
- Resume 前会恢复已经持久化的 Assistant Content，再继续新的流式输出。

安全恢复继续使用原 Turn、trace、消息、Tool History、Budget 和 Runtime State。

---

## Tool 与产物

当前 Built-in Tool Runtime 覆盖：

- File / Workspace；
- Terminal 与 Python；
- Git 与 Repository Inspection；
- DOCX、XLSX、PDF、PPTX、ZIP；
- Web Search 与网页正文读取；
- Local Knowledge Search；
- Image / Video Generation；
- Vision Analyze；
- Speech / Voice / Music；
- Skill；
- MCP；
- Automation 与 Time Tool。

Tool 是否真正可用，还取决于 Runtime 配置、Agent 配置、用户授权与 Access Policy。Tool 被注册不等于默认拥有无限权限。

---

## Object 与产物交付

生成文件和媒体保存为 `RuntimeObject`，而不是只作为聊天消息里的临时附件。

当前 Preview / Delivery 路径覆盖图片、音频、视频、PDF、Document、Spreadsheet、Presentation，以及 Preview Renderer 支持的 Text / Markdown / HTML 等常见类型。

Tool 成功产出 `assistant_output` Object 后，会立即绑定到当前 Assistant Message。因此后续 Model Call、Validation 或用户取消即使中断剩余 Turn，已经成功生成并交付的 Object 仍然可以保留和获取。

Image、Audio、Video 使用统一 Object Preview Panel，并支持放大查看。

---

## Knowledge 与 Memory

Local Knowledge Pipeline 包含 Document Ingestion、Chunking、可选 Embedding、PostgreSQL/pgvector Storage、Vector Retrieval、Lexical Retrieval 与 Hybrid Result Fusion。

Backend 还包含 Persistent Memory 的 Extraction、Storage、Retrieval、Frame、Governance、Observability 和 Agent Runtime Integration。

两者都属于共享 Agent Runtime 的能力，不是新的 Agent 执行引擎。

---

## Skill

SEEKMORE 支持基于 `SKILL.md` 的 Skill Package，包括创建、AI 辅助生成、Import、Resource、Capability Requirement、Validation、Version、Agent Binding、Runtime Loading 与导入包安全检查。

Skill 给现有 Runtime 提供特定任务所需的说明和资源，不会创建第二个 AgentLoop。

---

## MCP

SEEKMORE 可以作为 MCP Host / Client 使用用户创建或导入的 MCP Server。

当前 Runtime 包含：

- `stdio` 与 `streamable_http`；
- Desktop 管理的 Local Process 与 Remote Server；
- OAuth、Bearer Token、API Key、Custom Header、Environment Credential；
- Credential 加密存储；
- Tool Discovery 与 Invocation；
- Runtime Policy 与 Risk Metadata。

Built-in MCP Service Catalog 当前为空。第三方 MCP 只有在对应 Server 被真实添加和配置后才可用。

---

## 模型与 Media Provider

Agent Runtime 当前包含：

- OpenAI Chat Completions；
- OpenAI Responses；
- Anthropic Messages；
- Gemini Generate Content。

Media AI 与核心 AgentLoop 分离，包含 Image、Video、Speech、Voice、Music 等 Provider Adapter。

具体 Provider 可用性、Model Name、Price、Quota、Region 与 Output Quality 由用户配置的外部服务决定。

图片进入模型前会生成 Model-facing derivative，原始 `RuntimeObject` 不会被模型输入压缩覆盖。

---

## Workflow 与 Automation

Backend 包含职责不同的两套持久系统：

- **Workflow**：Workflow Run / Phase、State、Event、Scheduling 与 Workflow Runtime Tool；
- **Automation**：Scheduled Job、Lifecycle、Runner、Cancellation 与 Scheduler。

两者复用现有 Agent Runtime，不额外创建一套通用 Agent 执行内核。

---

## 权限与安全

SEEKMORE Tool 会产生真实副作用，包括修改文件、执行 Terminal Command、调用 External API 和执行 MCP Action。

Runtime 包含 Access Policy、Tool Risk Metadata、Approval Flow，并支持三种会话 / 任务权限模式：

- `confirm_required`；
- `audit_autorun`；
- `full_access`。

这些是执行权限控制，不代表所有第三方 Tool、Process 或 Script 都运行在完全隔离的安全沙箱中。授予高权限前应检查 Workspace、Command、Skill、MCP Server 与 Credential。

---

## 本地数据与外部服务

Desktop Release 会管理本地 Runtime，包括 Node.js、PostgreSQL、pgvector、RESP-compatible Cache、应用文件和 Runtime State。

当前 Release Lock 包含：

- Node.js `24.19.0`；
- PostgreSQL `18.4`；
- pgvector `0.8.6`；
- macOS：Valkey `9.1.1`；
- Windows：Garnet `2.1.4`。

本地存储不代表所有能力离线。启用 LLM、Embedding、Web Search、Media Provider、Remote MCP 或其它第三方服务后，相关任务数据可能会发送到对应服务，并受其条款、隐私政策和计费规则约束。

---

## 仓库结构

```text
seekmore/
├── backend/        # NestJS API、Agent Runtime、Tools、Objects、Memory、Knowledge、Skills、MCP
├── frontend/       # React + Vite UI
├── desktop/        # Electron Host、本地 Runtime 与进程管理
├── distribution/   # Runtime Vendoring、Stage、Packaging、Verify、Release Tests
└── assets/         # 产品资源
```

主要技术栈：

- React / Vite / TypeScript；
- Electron；
- Node.js / NestJS；
- Prisma / PostgreSQL / pgvector；
- Valkey / Garnet；
- Socket.IO；
- Model Context Protocol SDK。

---

## Contributing

Issue 和 Pull Request 应尽量基于可复现问题和现有真实执行链。

较大的架构修改建议先写清楚当前链路、具体失败或限制，以及最小需要改变的边界，再决定是否需要新增 Runtime 或抽象层。

---

## 项目边界

SEEKMORE 是开源桌面 Agent 项目，包含真实本地执行与第三方服务调用能力。开发和测试过程可能修改文件、执行命令、消耗 Provider Quota 或调用外部系统。

运行不可信任务或第三方集成前，应先检查配置与权限。

## 开源协议

MIT License。完整条款见 [`LICENSE`](LICENSE)。

---

## 注
本应用学习开发过程中没有任何一只seekmore受到伤害。
感谢朋友王晓光、赵畅、蒲翔鹭、冯铭伟、韩福乐。
感谢楼下咖啡店、公园椅子、我的电脑、咖啡杯。