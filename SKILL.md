# WeChat MP Publisher (Node.js)

## Requirements
- Node.js >= 22
- 环境变量：
    - WECHAT_MP_APPID
    - WECHAT_MP_APPSECRET

## Setup
- cd scripts
- npm i

## Actions (CLI)

0) 上传封面图获取 thumb_media_id（必需）
- 本地：
    - node ./scripts/wechat_mp_publish.mjs upload-thumb --file ./cover.jpg
- URL：
    - node ./scripts/wechat_mp_publish.mjs upload-thumb --url "https://example.com/cover.jpg"

1) 生成草稿（不会发布，用于二次确认）
- 自动摘要：
    - node ./scripts/wechat_mp_publish.mjs draft \
      --title "标题" \
      --md-file ./article.md \
      --thumb-media-id "THUMB_MEDIA_ID" \
      --digest-auto --digest-n 120

2) 发布（二次确认后手动执行）
- node ./scripts/wechat_mp_publish.mjs publish --media-id "DRAFT_MEDIA_ID"

3) 查询发布状态
- node ./scripts/wechat_mp_publish.mjs status --publish-id "PUBLISH_ID"

## Safety / Side Effects
- 会访问 api.weixin.qq.com 并创建草稿/发布文章（publish 为强副作用）。

## 图片规范（重要）

微信公众号草稿/发布接口对图片格式比较挑剔。为避免 `40137 invalid image format`：

- 正文图片：**只建议使用 JPG / PNG / GIF**
- **不要使用**：WEBP / AVIF / HEIC / SVG（很容易失败）
- 建议：单张图片不要过大（例如控制在 2~5MB 内），宽度 1080~2000 更稳

### Markdown 引用方式

- 本地图片（推荐，最稳）：
  ```markdown
  ![说明](./assets/demo.jpg)
  ```

- 外链图片（必须确保是真实可访问的 jpg/png/gif）：
  ```markdown
  ![说明](https://your-domain.com/demo.jpg)
  ```

### 图片格式自检（发布前必做）

- 查看文件真实格式（macOS / Linux）：
  ```bash
  file -I ./assets/demo.jpg
  ```

### 常见报错与原因

- `wechat err 40137: invalid image format`
    - 你的图片真实格式不是 jpg/png/gif（常见：webp/heic/svg）
    - 或图片内容损坏/编码异常

### 调用方自处理：将 WEBP/HEIC/AVIF 转成 JPG

> 任选其一工具

- 使用 `ffmpeg`：
  ```bash
  ffmpeg -i input.webp output.jpg
  ffmpeg -i input.heic output.jpg
  ffmpeg -i input.avif output.jpg
  ```

- 使用 ImageMagick（`magick`）：
  ```bash
  magick input.webp output.jpg
  ```

转换后，把 Markdown 里图片链接替换为 `output.jpg`（本地路径或可访问 URL）。


## 文章 Markdown 编写格式示例（可复制）

> 提示：本 Skill 会把 Markdown 转成 HTML 并投递到草稿。微信后台最终显示以其富文本渲染为准；尽量用“标题/段落/列表/引用/图片/代码块/表格”等通用元素，少用复杂 HTML/CSS。

### 示例 1：通用文章模板（最常用）

```markdown
# 文章标题：一句话说清楚收益

> 一句话导语：讲背景 + 结论/收益（建议 40~80 字）

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

### 示例 2：包含本地图片（会自动上传替换为微信 URL）

假设文件结构：
```text
article.md
assets/
  cover.png
  arch.png
```

```markdown
# 带图文章示例

这是封面/头图（注意：封面图仍需要单独 upload-thumb 获取 thumb_media_id）：
![封面图说明](./assets/cover.png)

## 架构图
![系统架构](./assets/arch.png)

说明文字……
```

### 示例 3：引用外部图片 URL（会先下载再上传到微信）

```markdown
# 外链图片示例

![演示图](https://example.com/demo.png)

说明文字……
```

### 示例 4：代码块（建议标注语言）

```markdown
# 代码示例

Go 代码：

```go
package main

import "fmt"

func main() {
  fmt.Println("hello")
}
```

Shell：

```bash
node ./scripts/wechat_mp_publish.mjs --help
```
```

### 示例 5：表格 + 清单（适合做对比/检查表）

```markdown
# 对比与清单

## 方案对比

| 方案 | 成本 | 上手难度 | 适用场景 |
|---|---:|---:|---|
| A | 低 | 低 | 小规模/快速验证 |
| B | 中 | 中 | 需要扩展性 |
| C | 高 | 高 | 强合规/强稳定 |

## 发布前检查清单
- [ ] 标题不超过 30 字（更利于展示）
- [ ] 首段有明确收益/结论
- [ ] 图片已在正文中引用（本地/URL 均可）
- [ ] 代码块可读（行不宜过长）
- [ ] 结尾有行动引导（关注/评论/链接）
```

### 示例 6：复盘类文章节奏（短段落 + 小标题）

```markdown
# 一次排障复盘：某接口 P99 从 800ms 降到 120ms

> 复盘结论：根因是 ……；通过 …… 优化，P99 降到 ……。

## 现象
- 用户反馈：……
- 监控表现：……

## 定位过程
先看 A 指标，再看 B 日志，最后用 C 工具确认。

## 根因
根因一句话：……

## 解决方案
- 改动 1：……
- 改动 2：……

## 效果
- P50：……
- P95：……
- P99：……

## 后续
- 防复发：……
- 可观测性：……
```
