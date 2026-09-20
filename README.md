# SEEKMORE

**Open-source desktop AI Agent Harness for Windows and macOS.**

[简体中文](README.zh-CN.md) · [Website](https://seekmore.ai)

SEEKMORE brings Agent Runtime, local tools, Skills, MCP, Memory, Knowledge, Runtime Objects, Workflow, Automation, and external model APIs together in one desktop application.


---

## Quick Start

### Requirements

- Node.js `24.19.0`
- pnpm `10.6.5`
- PostgreSQL with pgvector
- a RESP-compatible cache such as Redis / Valkey

Packaged desktop builds vendor their own local runtime. Running from source expects PostgreSQL and the cache service to be available locally or through the connection values in `backend/.env`.

### 1. Clone SEEKMORE

```bash
git clone https://github.com/holyhan00/SEEKMORE.git
cd seekmore
```

### 2. Install workspace dependencies

```bash
corepack enable
pnpm install
```

### 3. Configure the backend

The current source tree uses `backend/.env` for local development configuration.

At minimum, verify the database, cache, JWT, CORS, and MCP secret settings before starting the backend:

```dotenv
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5432/<database>

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

JWT_ACCESS_SECRET=<generate-a-development-secret>
JWT_REFRESH_SECRET=<generate-a-different-development-secret>
JWT_ISSUER=seekmore
JWT_AUDIENCE=seekmore-api
JWT_REFRESH_AUDIENCE=seekmore-refresh
JWT_ACCESS_TTL=15m

CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# Required when encrypted MCP credentials are used.
# Accepts a 32-byte key encoded as 64 hex characters or base64.
MCP_SECRET_ENCRYPTION_KEY=<32-byte-key>
```

Useful local secret generation commands:

```bash
openssl rand -hex 48   # JWT secret
openssl rand -hex 32   # MCP AES-256 key
```

Do not commit production credentials or provider API keys to the repository.

> The current tree contains a development `backend/.env`. Before publishing a fork, keep real secrets out of Git. A conventional alternative is to commit only a sanitized `.env.example` and keep the real `.env` local.

### 4. Apply Prisma migrations

```bash
pnpm --filter backend prisma:migrate
```

### 5. Start SEEKMORE

Run the three processes in separate terminals from the repository root:

```bash
pnpm dev:backend
```

```bash
pnpm dev:frontend
```

```bash
pnpm dev:desktop
```

Equivalent workspace commands are:

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

`SEEKMORE_RENDERER_DEV_URL` is optional; the desktop development runtime already defaults to `http://127.0.0.1:5173`.

### 6. Configure an LLM

After the desktop app opens:

1. Open **Settings → Model settings**.
2. Select the primary model provider and model.
3. Enter the provider API key and save.
4. Optionally configure separate Vision, Image, Video, Audio, and Web Search providers.

Model-provider credentials are configured through the application settings rather than the development `.env` shown above.

---

## Build From Source

Build all workspaces:

```bash
pnpm build
```

The root build runs Backend → Frontend → Desktop in order.

---

## macOS Application Build

Run the macOS release flow on macOS from the repository root.

```bash
cd seekmore

pnpm release:vendor:macos
pnpm release:build
pnpm release:stage
pnpm release:verify:stage
pnpm test:release:stage
```

If Electron downloads need the npm mirror used by this repository workflow:

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

Then package and verify the app and installer:

```bash
pnpm release:app:macos
pnpm release:verify:app:macos
pnpm release:installer:macos
pnpm release:verify:installer:macos
pnpm test:release:macos
```

The current macOS target is Apple Silicon (`arm64`) and produces a DMG. The release pipeline separately verifies the staged runtime, app bundle, installer, and release contracts.

---

## Windows Application Build

Run the Windows release flow on Windows from the repository root.

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

The current Windows target is `x64` and packages an NSIS installer.

---

## Core Architecture

The main chat execution path is:

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

`ChatTurnRequest` is the chat-level scheduling object. `AgentTurn` is the durable execution identity for one turn. `AgentLoop` performs iterative model/tool execution inside that turn.

Different Agent profiles share the same Runtime and can vary by model configuration, knowledge, Skills, workspace, and permissions.

---

## Durable AgentTurn and Checkpoint Recovery

SEEKMORE does not use a fixed wall-clock duration as the lifetime of an `AgentTurn`.

Model and tool calls keep their own timeouts, while the turn is bounded by iteration limits, no-progress detection, cancellation, approvals, and actual runtime errors.

`AgentTurnCheckpoint` stores resumable runtime state. Safe checkpoints are written after completed tool observations so completed work can be recovered without blindly replaying side effects.

Recovery is intentionally conservative:

- `ready` checkpoints can be resumed;
- `waiting_user` checkpoints can continue after user input;
- `executing_tools` is not blindly replayed because an external side effect may already have happened;
- persisted assistant content is rehydrated before resumed output continues.

Safe recovery keeps the same turn identity, trace, messages, tool history, budgets, and runtime state.

---

## Tools and Artifacts

The built-in Tool Runtime covers the current source capabilities across:

- files and workspaces;
- terminal execution and Python;
- Git and repository inspection;
- DOCX, XLSX, PDF, PPTX, and ZIP artifacts;
- web search and page reading;
- local knowledge retrieval;
- image and video generation;
- vision analysis;
- speech, voice, and music generation;
- Skills;
- MCP;
- Automation and time tools.

Tool availability depends on runtime configuration, Agent settings, authorization, and access policy. Registration does not imply unrestricted access.

---

## Objects and Artifact Delivery

Generated files and media are stored as `RuntimeObject` records rather than only existing as temporary chat attachments.

Current preview/delivery paths cover common object types including images, audio, video, PDF, documents, spreadsheets, presentations, and supported text/Markdown/HTML outputs.

A successfully produced assistant-output object is linked to the current assistant message as soon as the tool result is available. It can therefore remain available even if a later model call, validation step, or user cancellation stops the rest of the turn.

Image, audio, and video objects use the shared Object Preview panel, including an expanded view.

---

## Knowledge and Memory

The local knowledge pipeline includes document ingestion, chunking, optional embeddings, PostgreSQL/pgvector storage, vector retrieval, lexical retrieval, and hybrid result fusion.

The backend also contains persistent memory extraction, storage, retrieval, frames, governance, observability, and Agent Runtime integration.

Both are shared Runtime capabilities rather than separate Agent execution engines.

---

## Skill

SEEKMORE supports `SKILL.md`-based Skill packages with creation, AI-assisted generation, import, resources, capability requirements, validation, versioning, Agent binding, runtime loading, and imported-package security checks.

A Skill provides the existing Runtime with task-specific instructions and resources; it does not create a second AgentLoop.

---

## MCP

SEEKMORE acts as an MCP host/client for user-created or imported MCP servers.

The current runtime includes:

- `stdio` and `streamable_http` transports;
- local desktop-managed processes and remote servers;
- OAuth, Bearer Token, API Key, custom-header, and environment credential paths;
- encrypted credential storage;
- tool discovery and invocation;
- runtime policy and risk metadata.

The built-in MCP service catalog is intentionally empty. Third-party integrations become available only when a corresponding server is actually added and configured.

---

## Models and Media Providers

The Agent Runtime contains protocol adapters for:

- OpenAI Chat Completions;
- OpenAI Responses;
- Anthropic Messages;
- Gemini Generate Content.

Media AI is separate from the core AgentLoop and contains provider adapters for image, video, speech, voice, and music generation.

Provider availability, model names, prices, quotas, regional restrictions, and output quality are controlled by the external services configured by the user.

Model-facing image derivatives are normalized before provider calls while the original `RuntimeObject` remains unchanged.

---

## Workflow and Automation

The backend contains two distinct persistent systems:

- **Workflow** — workflow runs/phases, state, events, scheduling, and workflow runtime tools;
- **Automation** — scheduled jobs, lifecycle management, runner logic, cancellation, and scheduling.

They reuse the existing Agent Runtime rather than introducing another general-purpose Agent execution engine.

---

## Permissions and Safety

SEEKMORE tools can perform real side effects, including file changes, terminal commands, external API calls, and MCP actions.

The runtime includes access-policy evaluation, tool-risk metadata, approval flows, and three conversation/task permission modes:

- `confirm_required`;
- `audit_autorun`;
- `full_access`.

These controls are execution policy, not a claim that every external process or third-party tool runs inside a hardened sandbox. Review workspaces, commands, Skills, MCP servers, and credentials before granting broad permissions.

---

## Local Data and External Services

Packaged desktop builds manage local runtime components including Node.js, PostgreSQL, pgvector, a RESP-compatible cache, application files, and runtime state.

Current release locks include:

- Node.js `24.19.0`;
- PostgreSQL `18.4`;
- pgvector `0.8.6`;
- Valkey `9.1.1` on macOS;
- Garnet `2.1.4` on Windows.

Local storage does not mean every feature is offline. When LLMs, embeddings, web search, media providers, remote MCP servers, or other third-party services are enabled, relevant task data can be sent to those services under their own terms, privacy policies, and billing rules.

---

## Repository Structure

```text
seekmore/
├── backend/        # NestJS API, Agent Runtime, Tools, Objects, Memory, Knowledge, Skills, MCP
├── frontend/       # React + Vite UI
├── desktop/        # Electron host and local runtime/process management
├── distribution/   # Runtime vendoring, staging, packaging, verification, release tests
└── assets/         # Product assets
```

Main stack:

- React / Vite / TypeScript;
- Electron;
- Node.js / NestJS;
- Prisma / PostgreSQL / pgvector;
- Valkey / Garnet;
- Socket.IO;
- Model Context Protocol SDK.

---

## Contributing

Issues and pull requests should be grounded in reproducible behavior and the existing execution path.

For larger architecture changes, document the current path, the concrete failure or limitation, and the smallest boundary that needs to change before adding new runtimes or abstraction layers.

---

## Project Scope

SEEKMORE is an open-source desktop Agent project with real local execution and external-service integrations. Development and testing can modify files, execute commands, consume provider quotas, and call third-party systems.

Review configuration and permissions before running untrusted tasks or third-party integrations.

## License

MIT License. See [`LICENSE`](LICENSE) for the full text.

---

## Notes
No SEEKMORE was harmed during the learning and development of this application.
Thanks to Wang Xiaoguang, Zhao Chang, Pu Xianglu, Feng Mingwei, and Han Fule.
Thanks to the coffee shop downstairs, park benches, my computer, and my coffee mug.
