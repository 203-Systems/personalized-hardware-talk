# 从你的创意到个性化硬件

基于开放硬件的 AI 辅助创作 · 203 Systems

**[在线演示](https://203-systems.github.io/personalized-hardware-talk/)**

换机器维护请阅读 [HANDOFF.md](HANDOFF.md)，网站无需关闭，自动处理会话和维护端密钥需另行迁移。

原始讲座共 11 页，宽高比 **16:9**。这里提供按页浏览的网页，以及每页独立、可编辑的 PowerPoint 文件。

## 使用

- `←` / `→`、空格或 Page Up / Down 翻页，手机左右滑动。
- `O` 打开缩略图目录，`Home` / `End` 跳到首页或尾页。
- `F` 切换全屏，`H` 隐藏控制栏，`T` 查看本页文字。
- 地址中的 `#/7` 表示第 7 页，可以直接分享指定页。
- 控制栏下载当前页 PPTX，目录底部下载完整原稿。
- 顶部“版本”回看独立归档和更新说明，通过 `?v=v5#/7` 分享指定版本、指定页面。
- 顶栏“Agent”直接和维护本项目的 Claude Code 独立会话对话（203 团队口令登录）：说要改什么，它在项目里修改、验证、发布，回复和每一步操作实时显示；每条消息可选模型（Opus / Sonnet / Haiku / Fable）和思考强度，可附图片和文件，可停止、排队、重发、开启新会话。评论区的需求可一键“交给 Agent”。
- “评论 / 需求”直接匿名发送，不需要 GitHub 账号。可选择页面位置添加标注、回复、筛选类型和状态。打开面板后每 5 秒自动同步，需求下显示已验证的 AI 阶段、更新时间、处理记录和发布链接；保留正在输入的草稿。
- 提交者在原浏览器可撤回自己的内容、将状态更新为待处理、已计划、已完成或已解决。清除网站存储会丢失这项管理凭证，但已发送内容仍保存在服务器。

网页采用整页高清预览图，按原稿比例缩放，适配不同屏幕并留黑边，不裁切内容。网页文字与图片不拆成 HTML 对象；修改版式和文字请编辑对应 PPTX，再更新预览图。演讲动画、媒体播放及 PowerPoint 内部链接请使用 PPTX。

## 文件结构

```text
source/                完整原始 PPTX
slides/slide-01.pptx   每页独立 PPTX（01–11）
assets/previews/       对应整页 PNG
slides.json            页序、标题、文字、尺寸与文件路径
versions.json          版本目录和当前版本
versions/v5/           完整且不可覆盖的 v5 快照
index.html             演示入口
app.js                 翻页、目录、全屏、快捷键
styles.css             等比例显示与控制栏样式
scripts/               拆分、预览生成和完整性检查
collaboration.js       匿名评论、标注和需求界面
agent.js               “Agent”对话面板
agent-service/         Agent 服务：203 服务器上的 Claude Code 独立会话
feedback-service/      Cloudflare D1 后端及数据库迁移
```

独立 PPTX 直接复制原稿的幻灯片 XML 和依赖资源，保留文字、图片、主题、母版及演讲者备注，未将页面压平成图片。完整原稿保留不变。页面编号文件名不包含标题，后续改标题时链接不变。

## 本地预览

无需 npm 依赖：

```sh
python3 -m http.server 8000
```

打开 <http://localhost:8000>。请通过 HTTP 访问，直接双击 HTML 会受到浏览器读取 JSON 的限制。

## 修改与重新生成

单页修改：编辑 `slides/slide-NN.pptx`，替换对应 `assets/previews/slide-NN.png`，同步 `slides.json` 中该页的标题和文字。不要随后运行拆分脚本，否则会用完整原稿覆盖单页修改。也可以将修改同步到完整原稿后，走下面的全量流程。

从完整原稿重新拆分（会覆盖 `slides/` 和 `slides.json`）：

```sh
python3 scripts/split_pptx.py
python3 scripts/render_previews.py
python3 scripts/validate.py
```

拆分和检查只需 Python 标准库。预览生成使用 LibreOffice 和 Poppler，详见脚本帮助；需安装原稿使用的 HarmonyOS Sans SC、Arial 字体。预览图已提交，浏览演示不需要安装字体或 Office。

默认完整性检查验证单页结构、内部资源引用、比例和预览文件，允许各页独立修改。首次拆分后还可以运行 `python3 scripts/validate.py --against-source`，逐字节验证幻灯片内容和依赖资源与完整原稿一致；单页修改后无需通过这项额外比对。

## 发布

`main` 分支推送后，GitHub Actions（`.github/workflows/pages.yml`）自动检查并部署 GitHub Pages，约半分钟；每一次推送都是一次完整部署，不是在线修改的热更新，无需手动操作。部署时 `scripts/build_site.py` 把脚本和样式地址里的 `?r=` 替换成这些代码文件的内容哈希（并生成 `build.json`），所以每个版本的网址都是新的，浏览器不会把旧脚本配到新页面上；GitHub Pages 允许浏览器把 `index.html` 缓存最多 10 分钟，已经打开的页面刷新（⌘R）即可拿到最新版。推送后用下面的命令确认真的上线：

```sh
python3 scripts/verify_deploy.py        # 等该提交的部署成功，并逐字节核对线上文件与仓库一致
```

演示前端为静态文件，匿名反馈保存在独立 Sites / Cloudflare D1 服务，地址由 `collaboration-config.json` 指定。无需前端 Token，管理凭证由浏览器随机生成，服务器仅保存其摘要。

### 发布新的演示版本

编辑工作区 `slides/` 及对应预览和 `slides.json` 后，为当前文稿创建一个新版本：

```sh
python3 scripts/release_version.py v6 --notes '说明本次修改了哪些内容'
python3 scripts/validate_versions.py
git add .
git commit -m 'Publish deck v6'
git push
```

新版本自动成为默认版本。旧版本目录禁止覆盖，SHA-256 校验会阻止意外修改历史素材。仅修改工作区文件不会改变已归档的网页页面，必须发布新版本。评论和标注按版本、页码隔离，不自动搬到新版。

### 后端开发

见 [feedback-service/README.md](feedback-service/README.md)。后端变更通过 Sites 构建发布；GitHub Pages 工作流只部署前端。数据位于 D1 中，不会随前端重新部署丢失。评论面板打开且页面可见时，每 5 秒自动读取进度；后台暂停，联网或返回页面时恢复，读取失败保留上次结果。

网页“Agent”面板绑定到 203 服务器上的 Claude Code 独立会话（`agent-service/`，经 `https://apps.203.io/talk-agent/` 访问），团队成员可直接对话并选择模型和强度，详见 [agent-service/README.md](agent-service/README.md)。匿名需求的定时自动处理此前绑定到独立 Codex 维护会话，每 5 分钟检查一次，依赖维护电脑与 Codex 在线。各阶段通过签名进度记录显示，普通匿名访客不能仅通过冒用昵称伪造已验证进度。完整流程见 [automation/README.md](automation/README.md)。

匿名反馈公开可见，请勿填写私人信息。服务对输入长度、坐标和来源作校验，并限制单个管理凭证每小时 30 次提交、共享 IP 每小时 300 次提交。昵称为自填内容，不代表身份认证。

## 素材

品牌、产品图与其他第三方素材的来源保留在原稿和独立 PPTX 的演讲者备注中。本仓库公开不代表对第三方素材作额外授权。
