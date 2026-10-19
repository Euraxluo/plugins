# @magpie-community/opencode-deepseek-web-auth

OpenCode & [Magpie](https://usemagpie.ai) provider plugin for **DeepSeek Web** (`chat.deepseek.com`).

将 [deepseek2api](https://github.com/0xgetz/deepseek2api) 架构完整原生移植为 Magpie / OpenCode 社区插件。无需启动外部 Go 代理程序或 Docker 容器，直接通过浏览器 `userToken` 接入 DeepSeek 网页端，支持 DeepSeek-R1 深度思考流式输出、DeepSeek-V3 高速对话、联网搜索、图片多模态理解与原生高速 WebAssembly PoW 求解。

---

## 特性 (Features)

- **免额外服务与进程**：纯 JavaScript/ESM 模块，内嵌高性能 WebAssembly PoW 求解器，零第三方外部运行依赖。
- **全模型支持**：
  - `deepseek-chat` / `deepseek-v3`：DeepSeek-V3 快速对话
  - `deepseek-reasoner` / `deepseek-r1`：DeepSeek-R1 深度思考推理，完整映射 `reasoning_content`
  - `deepseek-search`：开启联网搜索的 DeepSeek-V3
  - `deepseek-reasoner-search`：深度思考 + 联网搜索
- **极速 DeepSeekHashV1 求解**：
  - 基于 4.8 KB 内嵌 WebAssembly（Keccak-f[1600] 23-round），5~10 万次哈希在 ~60-90ms 内解出，比网络往返还快
  - 提供纯 JS 兜底实现，兼容所有无 WASM 的沙箱环境
- **多轮会话复用 (Prefix Caching)**：
  - 对历史消息进行指纹哈希，智能沿用上游 `chat_session_id` 与 `parent_message_id`
  - 首轮自动注入系统提示词（`[System]...[/System]`），后续轮次免重复传输历史
  - LRU 自动清理过期 upstream 会话，防会话堆积与限流
- **多模态识图 (Vision)**：
  - 自动识别消息内的图片 URL 与 Base64 数据
  - 自动求解上传 PoW，上传至 DeepSeek 媒资库并轮询解析，挂载 `ref_file_ids`
- **支持流式与非流式**：
  - 完整适配 SSE `event: ready` / `fragments` patch 协议
  - 兼容 OpenAI Chat Completions 规范

---

## 获取 userToken (How to get userToken)

1. 在浏览器中打开并登录 [chat.deepseek.com](https://chat.deepseek.com)。
2. 按 `F12`（或右键点击「检查」）打开浏览器开发者工具。
3. 切换到 **Application**（应用程序）标签页。
4. 在左侧展开 **Storage** -> **Local Storage** -> `https://chat.deepseek.com`。
5. 找到 Key 为 `userToken` 的项，双击复制其 Value（支持直接复制形如 `eyJ...` 的 Token，也支持直接复制 `{"value":"eyJ..."}` JSON 格式，插件会自动解析标准化）。

---

## 安装与使用 (Usage)

### 在 Magpie 中使用

1. 安装插件：
```sh
magpie plugin add @magpie-community/opencode-deepseek-web-auth
```

2. 登录认证：
```sh
magpie plugin login deepseek-web
```
或直接在 Magpie 桌面客户端的 **Plugins (插件)** 页面点击 **DeepSeek Web** 进行连接，粘贴前面复制的 `userToken` 即可。

3. 调取模型：
在任意连接到 Magpie 的 Agent（如 Claude Code, Cursor, Cline, OpenCode 等）中直接指定模型：
- `deepseek-web/deepseek-chat`
- `deepseek-web/deepseek-reasoner`
- `deepseek-web/deepseek-search`
- `deepseek-web/deepseek-reasoner-search`

### 在 OpenCode 中使用

在你的 `opencode.json` 中配置：

```json
{
  "plugin": ["@magpie-community/opencode-deepseek-web-auth"]
}
```

然后执行：
```sh
opencode auth login
```
选择 `DeepSeek Web`，粘贴 `userToken` 完成授权。

---

## 模型清单 (Model Catalog)

| 模型 ID | 思考过程 (`reasoning_content`) | 联网搜索 (`search`) | 上下文大小 |
|---|---|---|---|
| `deepseek-chat` (`deepseek-v3`) | ✕ | ✕ | 64K |
| `deepseek-reasoner` (`deepseek-r1`) | ✓ | ✕ | 64K |
| `deepseek-search` | ✕ | ✓ | 64K |
| `deepseek-reasoner-search` | ✓ | ✓ | 64K |

---

## 架构说明 (Architecture)

```
[Agent / Magpie Gateway]
        │  OpenAI Chat Completions POST
        ▼
   [index.mjs]
   ├── [models.mjs]  模型匹配与启发式参数解析
   ├── [conv.mjs]    会话指纹计算与跨轮次 Session 复用
   ├── [client.mjs]  上游 chat.deepseek.com 请求通道
   │    ├── [pow.mjs]  WebAssembly 极速求解 DeepSeekHashV1
   │    └── 上传文件 / 会话管理 / 补全请求
   └── [sse.mjs]     DeepSeek patch 协议解析与 OpenAI SSE 格式实时转换
```

---

## 运行测试 (Testing)

```sh
bun test
# 或
node --test index.test.mjs
```

---

## 开源协议 (License)

MIT License
