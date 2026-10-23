# 从你的创意到个性化硬件

基于开放硬件的 AI 辅助创作 · 203 Systems

**[在线演示](https://203-systems.github.io/personalized-hardware-talk/)**

原始讲座共 11 页，宽高比 **16:9**。这里提供按页浏览的网页，以及每页独立、可编辑的 PowerPoint 文件。

## 使用

- `←` / `→`、空格或 Page Up / Down 翻页，手机左右滑动。
- `O` 打开缩略图目录，`Home` / `End` 跳到首页或尾页。
- `F` 切换全屏，`H` 隐藏控制栏，`T` 查看本页文字。
- 地址中的 `#/7` 表示第 7 页，可以直接分享指定页。
- 控制栏下载当前页 PPTX，目录底部下载完整原稿。

网页采用整页高清预览图，按原稿比例缩放，适配不同屏幕并留黑边，不裁切内容。网页文字与图片不拆成 HTML 对象；修改版式和文字请编辑对应 PPTX，再更新预览图。演讲动画、媒体播放及 PowerPoint 内部链接请使用 PPTX。

## 文件结构

```text
source/                完整原始 PPTX
slides/slide-01.pptx   每页独立 PPTX（01–11）
assets/previews/       对应整页 PNG
slides.json            页序、标题、文字、尺寸与文件路径
index.html             演示入口
app.js                 翻页、目录、全屏、快捷键
styles.css             等比例显示与控制栏样式
scripts/               拆分、预览生成和完整性检查
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

完整性检查用于确认本次拆分与原稿一致。若故意修改独立页面，需要同步更新完整原稿后再运行检查。

## 发布

`main` 分支推送后，GitHub Actions 自动检查并部署 GitHub Pages。网页为静态文件，无后台、账号或数据收集。

## 素材

品牌、产品图与其他第三方素材的来源保留在原稿和独立 PPTX 的演讲者备注中。本仓库公开不代表对第三方素材作额外授权。
