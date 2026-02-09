import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import { marked } from "marked";

function mustEnv(k) {
  const v = (process.env[k] || "").trim();
  if (!v) {
    console.error(`missing env ${k}`);
    process.exit(1);
  }
  return v;
}

async function httpJSON(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`http ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function getAccessToken(appid, secret) {
  const u =
      "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential" +
      `&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
  const tr = await httpJSON("GET", u, null);
  if (tr.errcode) throw new Error(`token err ${tr.errcode}: ${tr.errmsg}`);
  if (!tr.access_token) throw new Error("empty access_token");
  return tr.access_token;
}

async function downloadToBytes(rawUrl) {
  const res = await fetch(rawUrl);
  const ab = await res.arrayBuffer();
  if (!res.ok) throw new Error(`download http ${res.status}: ${Buffer.from(ab).toString("utf8")}`);
  const ct = res.headers.get("content-type") || "";
  return { bytes: new Uint8Array(ab), contentType: ct };
}

function guessFilename(p, fallback) {
  if (!p) return fallback;
  const base = path.basename(p);
  return base && base !== "." && base !== "/" ? base : fallback;
}

async function multipartUpload(url, fieldName, filename, bytes) {
  // Node 22+: FormData/Blob 可用
  const fd = new FormData();
  fd.append(fieldName, new Blob([bytes]), filename);
  const res = await fetch(url, { method: "POST", body: fd });
  const text = await res.text();
  if (!res.ok) throw new Error(`http ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function uploadThumbMediaId(token, { file, url }) {
  let bytes, filename;
  if (file) {
    bytes = await fs.readFile(file);
    filename = guessFilename(file, "cover.jpg");
  } else {
    const d = await downloadToBytes(url);
    bytes = Buffer.from(d.bytes);
    filename = "cover.jpg";
  }

  const endpoint =
      "https://api.weixin.qq.com/cgi-bin/material/add_material" +
      `?access_token=${encodeURIComponent(token)}&type=image`;
  const mr = await multipartUpload(endpoint, "media", filename, bytes);
  if (mr.errcode) throw new Error(`wechat err ${mr.errcode}: ${mr.errmsg}`);
  if (!mr.media_id) throw new Error("empty media_id");
  return mr;
}

async function uploadContentImageUrl(token, filename, bytes) {
  const endpoint =
      "https://api.weixin.qq.com/cgi-bin/media/uploadimg" +
      `?access_token=${encodeURIComponent(token)}`;
  const ur = await multipartUpload(endpoint, "media", filename, bytes);
  if (ur.errcode) throw new Error(`wechat err ${ur.errcode}: ${ur.errmsg}`);
  if (!ur.url) throw new Error("empty url from uploadimg");
  return ur.url;
}

const mdImageRe = /!\[[^\]]*]\(([^)]+)\)/g;

async function rewriteMarkdownImages({ token, md, baseDir }) {
  const cache = new Map(); // hash -> wxUrl
  const uploaded = [];

  // 收集匹配位置（方便从后往前替换）
  const matches = [];
  for (const m of md.matchAll(mdImageRe)) {
    matches.push({ full: m[0], raw: m[1], index: m.index, len: m[0].length });
  }
  if (matches.length === 0) return { md, uploaded };

  let out = md;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { raw, index, len } = matches[i];
    let ref = (raw || "").trim().replace(/^['"]|['"]$/g, "");
    if (!ref) continue;

    let bytes, filename;
    if (ref.startsWith("http://") || ref.startsWith("https://")) {
      const d = await downloadToBytes(ref);
      bytes = Buffer.from(d.bytes);
      filename = "img.jpg";
    } else {
      let p = ref;
      if (!path.isAbsolute(p)) p = path.join(baseDir, p);
      bytes = await fs.readFile(p);
      filename = guessFilename(p, "img.jpg");
    }

    // 简单去重：用 sha256
    const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
    const hashHex = Buffer.from(hashBuf).toString("hex");
    let wxUrl = cache.get(hashHex);
    if (!wxUrl) {
      wxUrl = await uploadContentImageUrl(token, filename, bytes);
      cache.set(hashHex, wxUrl);
      uploaded.push(wxUrl);
    }

    // 替换括号内链接部分：用最简单方式直接替换整段图片语法里的 url
    const before = out.slice(0, index);
    const piece = out.slice(index, index + len);
    const after = out.slice(index + len);
    const replacedPiece = piece.replace(/\(([^)]+)\)/, `(${wxUrl})`);
    out = before + replacedPiece + after;
  }

  return { md: out, uploaded };
}

function autoDigestFromMarkdown(md, n) {
  if (!md || n <= 0) return "";
  let s = md.trim();

  // 粗略去 front-matter
  if (s.startsWith("---")) {
    const j = s.indexOf("\n---", 3);
    if (j >= 0) s = s.slice(j + 4);
  }

  // 去代码块/行内代码
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`[^`]*`/g, " ");
  // 去图片
  s = s.replace(/!\[[^\]]*]\([^)]+\)/g, " ");
  // 链接保留文本
  s = s.replace(/\[([^\]]*)]\([^)]+\)/g, "$1");
  // 去 HTML 标签
  s = s.replace(/<[^>]+>/g, " ");
  // 去 markdown 符号
  s = s.replace(/[#>*_|-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  const r = Array.from(s);
  if (r.length <= n) return s;
  return r.slice(0, n).join("") + "...";
}

async function cmdUploadThumb({ file, url }) {
  if ((!file && !url) || (file && url)) {
    console.error("provide exactly one of --file or --url");
    process.exit(2);
  }
  const appid = mustEnv("WECHAT_MP_APPID");
  const secret = mustEnv("WECHAT_MP_APPSECRET");
  const token = await getAccessToken(appid, secret);

  const mr = await uploadThumbMediaId(token, { file, url });
  console.log("ok");
  console.log("thumb_media_id:", mr.media_id);
  if (mr.url) console.log("thumb_url:", mr.url);
}

async function cmdDraft(opts) {
  const { title, author, digest, mdFile, contentSourceUrl, thumbMediaId, digestAuto, digestN } = opts;
  if (!title || !mdFile || !thumbMediaId) {
    console.error("missing required: --title, --md-file, --thumb-media-id");
    process.exit(2);
  }

  const appid = mustEnv("WECHAT_MP_APPID");
  const secret = mustEnv("WECHAT_MP_APPSECRET");
  const token = await getAccessToken(appid, secret);

  const md = await fs.readFile(mdFile, "utf8");
  const baseDir = path.dirname(mdFile);

  const { md: md2, uploaded } = await rewriteMarkdownImages({ token, md, baseDir });

  let dg = (digest || "").trim();
  if (!dg && digestAuto) dg = autoDigestFromMarkdown(md, Number(digestN || 120));

  const contentHTML = marked.parse(md2, { gfm: true, breaks: true });

  const draftReq = {
    articles: [
      {
        title,
        author: (author || "").trim() || undefined,
        digest: dg || undefined,
        content: contentHTML,
        content_source_url: (contentSourceUrl || "").trim() || undefined,
        thumb_media_id: thumbMediaId,
      },
    ],
  };

  const draftURL =
      "https://api.weixin.qq.com/cgi-bin/draft/add" +
      `?access_token=${encodeURIComponent(token)}`;

  const dr = await httpJSON("POST", draftURL, draftReq);
  if (dr.errcode) throw new Error(`draft add err ${dr.errcode}: ${dr.errmsg}`);
  if (!dr.media_id) throw new Error("draft add: empty media_id");

  const preview = Array.from(md.trim()).slice(0, 200).join("") + (Array.from(md.trim()).length > 200 ? "..." : "");

  console.log("ok");
  console.log("draft_media_id:", dr.media_id);
  console.log("title:", title);
  if (dg) console.log("digest:", dg);
  console.log("md_preview:", preview.replace(/\s+/g, " ").trim());
  console.log("uploaded_content_images:", uploaded.length);
  console.log(`next_step: run \`publish --media-id ${dr.media_id}\` after you confirm in 公众号后台草稿箱`);
}

async function cmdPublish({ mediaId }) {
  if (!mediaId) {
    console.error("missing --media-id");
    process.exit(2);
  }
  const appid = mustEnv("WECHAT_MP_APPID");
  const secret = mustEnv("WECHAT_MP_APPSECRET");
  const token = await getAccessToken(appid, secret);

  const pubURL =
      "https://api.weixin.qq.com/cgi-bin/freepublish/submit" +
      `?access_token=${encodeURIComponent(token)}`;
  const pr = await httpJSON("POST", pubURL, { media_id: mediaId });
  if (pr.errcode) throw new Error(`publish err ${pr.errcode}: ${pr.errmsg}`);
  console.log("ok");
  console.log("publish_id:", pr.publish_id);
}

async function cmdStatus({ publishId }) {
  if (!publishId) {
    console.error("missing --publish-id");
    process.exit(2);
  }
  const appid = mustEnv("WECHAT_MP_APPID");
  const secret = mustEnv("WECHAT_MP_APPSECRET");
  const token = await getAccessToken(appid, secret);

  const stURL =
      "https://api.weixin.qq.com/cgi-bin/freepublish/get" +
      `?access_token=${encodeURIComponent(token)}`;
  const sr = await httpJSON("POST", stURL, { publish_id: publishId });
  if (sr.errcode) throw new Error(`status err ${sr.errcode}: ${sr.errmsg}`);
  console.log(JSON.stringify(sr, null, 2));
}

const program = new Command();

program
    .name("wechat_mp_publish")
    .description("WeChat MP Publisher (draft + confirm publish)")
    .showHelpAfterError();

program
    .command("upload-thumb")
    .option("--file <path>", "local image file")
    .option("--url <url>", "image url")
    .action((opts) => cmdUploadThumb(opts).catch(fatal));

program
    .command("draft")
    .requiredOption("--title <title>", "article title")
    .requiredOption("--md-file <path>", "markdown file")
    .requiredOption("--thumb-media-id <id>", "thumb media_id")
    .option("--author <author>", "author")
    .option("--content-source-url <url>", "source url")
    .option("--digest <digest>", "digest")
    .option("--digest-auto", "auto generate digest from markdown", false)
    .option("--digest-n <n>", "digest length (runes)", "120")
    .action((opts) =>
        cmdDraft({
          title: opts.title,
          author: opts.author,
          digest: opts.digest,
          mdFile: opts.mdFile,
          contentSourceUrl: opts.contentSourceUrl,
          thumbMediaId: opts.thumbMediaId,
          digestAuto: !!opts.digestAuto,
          digestN: opts.digestN,
        }).catch(fatal)
    );

program
    .command("publish")
    .requiredOption("--media-id <id>", "draft media_id")
    .action((opts) => cmdPublish({ mediaId: opts.mediaId }).catch(fatal));

program
    .command("status")
    .requiredOption("--publish-id <id>", "publish_id")
    .action((opts) => cmdStatus({ publishId: opts.publishId }).catch(fatal));

await program.parseAsync(process.argv);

function fatal(err) {
  console.error("error:", err?.message || err);
  process.exit(1);
}
