# 演讲网页 Agent 服务

网页顶栏「Agent」面板背后的服务：203 服务器上一个专门维护本项目的 **Claude Code 独立会话**。团队成员在部署好的网页里直接对话，每条消息都可以选模型和思考强度。

```
网页（GitHub Pages）→ https://apps.203.io/talk-agent/api/… → 203 apps 网关 → 本服务 127.0.0.1:8797 → claude -p --resume <会话>
```

- **一个会话**：每条消息是同一个 Claude Code 会话的下一轮（第一轮 `--session-id`，之后 `--resume`），在项目根目录运行，记得之前聊过的内容。多位成员共用，消息开头带发送人和正在看的版本/页码。面板「新会话」把当前对话存档到 `STATE_DIR/history/` 并从头开始；会话记录丢失时自动换新会话。
- **模型和强度**：Opus 5.5（默认）/ Sonnet 5.5 / Haiku 5.5 / Fable 5.1，强度 低 / 中 / 高 / 很高（默认）/ 最高，与 203 工作台相同；每条消息单独生效（`--model` / `--effort`）。
- **实时**：Claude 以 `stream-json` 输出，回复逐字显示，每次调用工具（运行命令、查看/修改文件…）显示为一步，可展开看命令和输出。面板长轮询 `GET /api/state?rev=N&wait=20`，只取变化的消息。
- **排队 / 停止**：同一时间只跑一轮，其余排队，可取消；「停止」立刻结束 Claude 及它启动的命令（独立进程组）。20 分钟没有任何输出判定卡住，单轮最长 180 分钟（`AGENT_IDLE_MINUTES` / `AGENT_TIMEOUT_MINUTES`）。服务重启时进行中的一轮标为中断，排队的继续。
- **附件**：图片和文件（每条最多 6 个、单个 10 MB）存到 `STATE_DIR/uploads/`，消息里附上路径让 Claude 用 Read 查看。
- **登录**：用 203 工作台的团队口令（服务每次登录时从 `TEAM_CODE_FILE` 读取，不进入 Claude 的环境变量）+ 昵称，换得 30 天滑动有效的令牌，服务器只存摘要。浏览器只接受 `ALLOWED_ORIGINS`（默认 GitHub Pages 和本地 8000 端口）。
- **工具**：Bash、Read、Edit、Write、Glob、Grep、WebFetch、WebSearch、TodoWrite，`--permission-mode dontAsk`，不加载 MCP 和斜杠命令，每轮最多 200 步。工作规则在 `server.mjs` 的 `systemPrompt()`。

## 接口（均在 `BASE_PATH` 下，除登录外需 `Authorization: Bearer <令牌>`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | `{code, name}` → `{token, name}`，每 IP 15 分钟 15 次 |
| GET | `/api/state?rev=N&wait=S` | 当前状态和 rev N 之后变化的消息；`wait` 秒内没有变化就等待 |
| POST | `/api/messages` | `{text, model, effort, context:{version,slide,title,url}, files:[{name,type,data(base64)}]}` |
| POST | `/api/stop` · `/api/cancel` · `/api/retry` | 停止当前一轮 · 取消排队 `{id}` · 重新发送 `{id, model?, effort?}` |
| POST | `/api/new-session` · `/api/logout` | 存档并开启新会话 · 退出登录 |
| GET | `/api/files/<消息>/<序号>` · `/api/health` | 附件 · 健康检查 |

## 运行

```sh
node --test test/server.test.mjs        # 用假的 claude 跑完整流程，无需联网
cp 203-talk-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now 203-talk-agent
```

网关路由在 203work 仓库 `gateway/routes.json`（`/talk-agent` → `127.0.0.1:8797`），改后 `systemctl --user reload 203-apps-gateway`。状态在 `STATE_DIR`（默认 `~/203-talk-agent`，0700），包括对话、会话 ID、登录摘要和附件，不进 Git。修改 `server.mjs` 后需要 `systemctl --user restart 203-talk-agent`（会中断正在进行的一轮）。
