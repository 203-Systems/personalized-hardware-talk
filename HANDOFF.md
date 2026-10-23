# 换机器继续维护

网站和匿名反馈服务在云端运行，无需关闭网站，也无需旧电脑开机。编辑电脑只负责修改、提交、发布以及运行 Codex 自动处理。当前文稿版本为 v7（11 页），v5/v6 历史归档保留；以 `versions.json` 为准。请求处理记录在 `automation/requests.json`。

## 新机器准备

1. 克隆 `https://github.com/203-Systems/personalized-hardware-talk.git`，在 Codex 中将克隆目录添加为本地项目，并在该项目创建独立维护会话。不要继续使用旧机器的绝对目录作为执行位置。
2. 在新机器授权 GitHub 推送和 Actions 查看权限。若需要修改后端，还需连接有权访问现有 Sites 项目的账号。不要新建仓库、反馈服务或数据库。
3. 将旧项目中未入库的 `.automation/` 目录，通过你信任的安全传输方式复制到新项目根目录；其中 `progress-key.pem` 是 AI 进度签名私钥，`feedback-edit-key` 是匿名 AI 回复的管理凭证。只用于维护端，不能上传公共仓库、粘贴网页评论或放入对话。目录权限建议 700，文件权限 600。不要运行 `node scripts/progress_sign.mjs init` 重置公钥；否则历史进度验证会失效。目录缺失时先报告，不要静默重建身份。
4. 基础维护需要 Python 3、Node.js、curl、Git；GitHub CLI 用于发布核对。PPT 预览需要 LibreOffice、Poppler 和原稿字体 HarmonyOS Sans SC、Arial。后端依赖按 `feedback-service/README.md` 安装。
5. 验证本地与服务：

   ```sh
   python3 scripts/validate.py
   python3 scripts/validate_versions.py
   node scripts/test_progress.mjs
   python3 scripts/feedback_queue.py list
   ```

6. 在新会话按 `automation/README.md` 接续工作，并重新建立每 5 分钟一次、绑定新会话的自动处理任务。定时任务绑定本地会话及目录，不随 Git 克隆自动迁移。新机器接管前，确认旧机器同名自动任务已暂停，避免双重发布。

## 给新会话的启动说明

> 请接管这个演讲网页项目，先读取 HANDOFF.md、README.md 和 automation/README.md，核对仓库、版本、线上服务和需求台账。沿用现有仓库、网址与反馈数据库，验证迁移后的本地进度签名身份，不公开任何密钥。准备就绪后，将网页需求的自动处理绑定到本会话，每 5 分钟读取所有版本/页面的新需求和回复；按实际阶段回写进度，完成修改、验证、发布并回复新版链接。保留历史版本，不重复处理已完成请求。请先确认旧机器自动任务已暂停；本授权允许你在此新会话创建该定时任务，并在本项目范围自动修改、发版和回写。

## 固定资源

- 仓库：https://github.com/203-Systems/personalized-hardware-talk
- 网站：https://203-systems.github.io/personalized-hardware-talk/
- 反馈 API：https://hardware-talk-feedback-203.goofy-skink-7467.chatgpt.site/api/feedback
- Sites 项目：`appgprj_6adada92d01c819199bf41a628d362ce`，后端源码及身份配置在 `feedback-service/`。
- 网页“Agent”面板：203 服务器（运行 203 工作台的 Ubuntu 机器）上的 Claude Code 独立会话，服务 `203-talk-agent.service`（用户级 systemd），源码 `agent-service/`，经 203 apps 网关 `https://apps.203.io/talk-agent/` 访问，登录用 203 工作台团队口令。对话、会话 ID 和附件在该机器 `~/203-talk-agent/`，不进 Git。该机器上没有 `.automation/` 进度签名私钥。

前端推送 `main` 后由 GitHub Pages 自动部署（`scripts/build_site.py` 给脚本样式加内容哈希，推送后用 `python3 scripts/verify_deploy.py` 核对线上与仓库一致），后端单独通过 Sites 发布。网页 Agent 服务（`agent-service/server.mjs`）被改动后，空闲时会自己检查并加载新代码，不需要手动重启。数据存放于 D1，不在本地文件夹内，不需要下载或重建生产数据库。新机器提交者浏览器的匿名身份和草稿不通过 Git 同步；这与维护端密钥不同。
