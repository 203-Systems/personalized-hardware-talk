# 203 演讲协作服务

通过 Sites 托管的 Vinext / Cloudflare Worker，使用 D1 持久化匿名评论、标注、需求和回复。前端仍位于主仓库的 GitHub Pages。

## 开发

```sh
npm run install:ci
npm run db:generate  # 仅在 schema 改动时运行
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_luxuriant_nitro.sql
npm run start -- --port 8787
```

迁移只对全新本地数据库执行一次。后续新增结构用 Drizzle 生成新迁移，保留已应用 SQL 和 meta 文件不变。Sites 发布时应用生产迁移，生产数据不会进入 Git 仓库。

在仓库根目录运行 `python3 scripts/test_feedback.py` 验证本地存储、版本/页码隔离、回复、幂等重试、权限、撤回和速率限制。该脚本拒绝向非本机地址写入测试数据。手工浏览器测试时，可临时将根目录 `collaboration-config.json` 的 API 指向 `http://127.0.0.1:8787/api/feedback`；测试后务必还原生产地址。

## API

- `GET /api/feedback?version=v5&slide=7&offset=0` 返回本页讨论、回复及是否还有更多，每批 30 条。可附带 `thread=<id>` 定位单条讨论。
- `POST /api/feedback` 创建评论、需求或回复，成功后数据库返回记录 ID。
- `PATCH /api/feedback` 更新提交者自己的讨论状态。
- `DELETE /api/feedback` 将提交者自己的内容改为撤回占位，不删除其他人的回复。

写入使用 JSON 请求和 `X-Edit-Key`。该值是浏览器生成的 32 字节随机秘密，仅在浏览器保存；D1 仅存 SHA-256 摘要。公开读取不包含凭证摘要。跨设备可读、可回复，不会取得原提交者的管理权限。

没有全站匿名管理权限。状态操作和撤回仅限凭证持有人；部署管理员可通过 Sites 数据工具检查数据。增加全站管理界面时应单独接入受保护的管理员身份。

允许的跨域网页为 `https://203-systems.github.io` 和本机 8000 端口。更换演示域名需同步更新服务端来源列表。
