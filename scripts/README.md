# wechat_mp_publish.mjs

## 环境变量
export WECHAT_MP_APPID="xxx"
export WECHAT_MP_APPSECRET="yyy"

## 安装依赖
cd scripts && npm i

## 典型流程
1) 上传封面拿 thumb_media_id
   node ./wechat_mp_publish.mjs upload-thumb --file ./cover.jpg

2) 生成草稿（不发布；digest 自动生成）
   node ./wechat_mp_publish.mjs draft --title "标题" --md-file ./article.md --thumb-media-id "THUMB_MEDIA_ID" --digest-auto --digest-n 120

3) 你去公众号后台草稿箱确认无误后发布
   node ./wechat_mp_publish.mjs publish --media-id "DRAFT_MEDIA_ID"

4) 查状态
   node ./wechat_mp_publish.mjs status --publish-id "PUBLISH_ID"
