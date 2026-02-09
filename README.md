# wechat-mp-publish

用于将 Markdown 文章发布到微信公众号的命令行工具（Node.js）。支持封面上传、草稿生成、发布与状态查询。

## 功能特性
- 上传封面图获取 `thumb_media_id`
- 将 Markdown 转换并生成公众号草稿
- 手动确认后发布草稿
- 查询发布状态

## 环境要求
- Node.js >= 22
- 环境变量：
  - `WECHAT_MP_APPID`
  - `WECHAT_MP_APPSECRET`

## 安装
```bash
cd scripts
npm i
```

## 典型流程
0) 上传封面图（必需）
```bash
node ./scripts/wechat_mp_publish.mjs upload-thumb --file ./cover.jpg
```

1) 生成草稿（不发布）
```bash
node ./scripts/wechat_mp_publish.mjs draft \
  --title "标题" \
  --md-file ./article.md \
  --thumb-media-id "THUMB_MEDIA_ID" \
  --digest-auto --digest-n 120
```

2) 发布草稿（在公众号后台确认无误后执行）
```bash
node ./scripts/wechat_mp_publish.mjs publish --media-id "DRAFT_MEDIA_ID"
```

3) 查询发布状态
```bash
node ./scripts/wechat_mp_publish.mjs status --publish-id "PUBLISH_ID"
```

## 图片规范（重要）
微信公众号草稿/发布接口对图片格式较严格，为避免 `40137 invalid image format`：
- 正文图片仅建议 JPG / PNG / GIF
- 不要使用 WEBP / AVIF / HEIC / SVG
- 单张图片建议控制在 2~5MB，宽度 1080~2000 更稳

### Markdown 引用方式
本地图片（推荐）：
```markdown
![说明](./assets/demo.jpg)
```

外链图片（需确保是可访问的 jpg/png/gif）：
```markdown
![说明](https://your-domain.com/demo.jpg)
```

### 图片格式自检
```bash
file -I ./assets/demo.jpg
```

### 转换示例
使用 `ffmpeg`：
```bash
ffmpeg -i input.webp output.jpg
ffmpeg -i input.heic output.jpg
ffmpeg -i input.avif output.jpg
```

使用 ImageMagick（`magick`）：
```bash
magick input.webp output.jpg
```

## 目录结构
```text
.
├── assets/          # 示例资源
└── scripts/
    ├── wechat_mp_publish.mjs
    ├── package.json
    └── README.md
```

## 安全与副作用
工具会访问 `api.weixin.qq.com` 并创建草稿或发布文章（`publish` 为强副作用）。
