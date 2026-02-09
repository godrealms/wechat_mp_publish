---
name: wechat-mp-publisher
description: Publish WeChat Official Account articles with Node.js CLI, including uploading cover images, creating drafts from Markdown, publishing drafts, and checking publish status. Use when working with scripts/wechat_mp_publish.mjs or when preparing Markdown/images for WeChat MP draft/publish flows.
---

# WeChat MP Publisher (Node.js)

## Quick Start
- Install deps in `scripts/`:
  - `cd scripts`
  - `npm i`
- Set env vars:
  - `WECHAT_MP_APPID`
  - `WECHAT_MP_APPSECRET`

## CLI Actions

1) Upload cover and get `thumb_media_id` (required)
- Local file:
  - `node ./scripts/wechat_mp_publish.mjs upload-thumb --file ./cover.jpg`
- URL:
  - `node ./scripts/wechat_mp_publish.mjs upload-thumb --url "https://example.com/cover.jpg"`

2) Create draft from Markdown (no publish)
- Auto digest:
  - `node ./scripts/wechat_mp_publish.mjs draft --title "标题" --md-file ./article.md --thumb-media-id "THUMB_MEDIA_ID" --digest-auto --digest-n 120`

3) Publish after review
- `node ./scripts/wechat_mp_publish.mjs publish --media-id "DRAFT_MEDIA_ID"`

4) Check publish status
- `node ./scripts/wechat_mp_publish.mjs status --publish-id "PUBLISH_ID"`

## Safety / Side Effects
- Calls `api.weixin.qq.com`, creates drafts, and publishes articles (`publish` is a strong side effect).

## Image Rules (Important)

Follow these to avoid `wechat err 40137: invalid image format`:
- Use only JPG / PNG / GIF for body images.
- Avoid WEBP / AVIF / HEIC / SVG (likely to fail).
- Keep images reasonable in size (e.g., 2~5MB) and width 1080~2000.

### Markdown Image Syntax
- Local (recommended):
  ```markdown
  ![说明](./assets/demo.jpg)
  ```
- Remote (must be reachable jpg/png/gif):
  ```markdown
  ![说明](https://your-domain.com/demo.jpg)
  ```

### Verify Image Format (before publish)
- macOS / Linux:
  ```bash
  file -I ./assets/demo.jpg
  ```

### Convert WEBP/HEIC/AVIF to JPG
- `ffmpeg`:
  ```bash
  ffmpeg -i input.webp output.jpg
  ffmpeg -i input.heic output.jpg
  ffmpeg -i input.avif output.jpg
  ```
- ImageMagick (`magick`):
  ```bash
  magick input.webp output.jpg
  ```
Update Markdown links to the new JPG path or URL.

## Markdown Writing Guidance

Keep content simple (title/paragraph/list/quote/image/code/table). The script converts Markdown to HTML; WeChat renders its own rich text.

### Minimal Article Template
```markdown
# 标题：一句话说清楚收益

> 导语：讲背景 + 结论/收益（40~80 字）

## TL;DR
- 结论 1：……
- 结论 2：……
- 适用人群：……

## 背景
这篇文章要解决的问题是：……

## 方案
### 方案 A：……
- 优点：……
- 缺点：……

### 方案 B：……
- 优点：……
- 缺点：……

## 实操步骤
1. 第一步……
2. 第二步……
3. 第三步……

## 常见坑
- 坑 1：……
- 坑 2：……

## 总结
一句话总结 + 下一步行动。
```

### Local Images Example
```text
article.md
assets/
  cover.png
  arch.png
```

```markdown
# 带图文章示例

封面图仍需单独 upload-thumb 获取 thumb_media_id：
![封面图说明](./assets/cover.png)

## 架构图
![系统架构](./assets/arch.png)
```
