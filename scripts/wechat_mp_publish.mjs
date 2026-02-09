import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import MarkdownIt from "markdown-it";
import mdAbbr from "markdown-it-abbr";
import mdAttrs from "markdown-it-attrs";
import mdContainer from "markdown-it-container";
import mdDeflist from "markdown-it-deflist";
import mdEmoji from "markdown-it-emoji";
import mdFootnote from "markdown-it-footnote";
import mdIns from "markdown-it-ins";
import mdMark from "markdown-it-mark";
import mdSub from "markdown-it-sub";
import mdSup from "markdown-it-sup";
import mdTaskLists from "markdown-it-task-lists";
import mdTexmath from "markdown-it-texmath";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
});

md.use(mdAbbr)
  .use(mdAttrs)
  .use(mdContainer, "info")
  .use(mdContainer, "warning")
  .use(mdContainer, "tip")
  .use(mdDeflist)
  .use(mdEmoji)
  .use(mdFootnote)
  .use(mdIns)
  .use(mdMark)
  .use(mdSub)
  .use(mdSup)
  .use(mdTaskLists, { enabled: true })
  .use(mdTexmath);

// WeChat rejects <input>; render task list checkboxes as plain text.
md.renderer.rules.checkbox_input = (tokens, idx) => {
  const checked = tokens[idx].attrGet("checked") !== null;
  return checked ? "[x] " : "[ ] ";
};

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

function extractTitleFromMarkdown(md) {
  if (!md) return "";
  // Prefer YAML frontmatter title if present.
  if (md.startsWith("---")) {
    const fmEnd = md.indexOf("\n---");
    if (fmEnd >= 0) {
      const fm = md.slice(3, fmEnd);
      const m = fm.match(/^\s*title:\s*(.+)\s*$/m);
      if (m && m[1]) return m[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }

  // Fallback to first ATX H1.
  const h1 = md.match(/^#\s+(.+)\s*$/m);
  if (h1 && h1[1]) return h1[1].trim();
  return "";
}

async function rewriteImageTokens({ token, tokens, baseDir }) {
  const cache = new Map(); // hash -> wxUrl
  const uploaded = [];

  async function handleImageToken(t) {
    const src = (t.attrGet("src") || "").trim();
    if (!src) return;

    let bytes, filename;
    try {
      if (src.startsWith("http://") || src.startsWith("https://")) {
        const d = await downloadToBytes(src);
        bytes = Buffer.from(d.bytes);
        filename = "img.jpg";
      } else {
        let p = src;
        if (!path.isAbsolute(p)) p = path.join(baseDir, p);
        bytes = await fs.readFile(p);
        filename = guessFilename(p, "img.jpg");
      }
    } catch (err) {
      throw new Error(`image read failed for ${src}: ${err?.message || err}`);
    }

    if (!bytes || bytes.length === 0) {
      throw new Error(`image is empty for ${src}`);
    }

    // 简单去重：用 sha256
    const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
    const hashHex = Buffer.from(hashBuf).toString("hex");
    let wxUrl = cache.get(hashHex);
    if (!wxUrl) {
      try {
        wxUrl = await uploadContentImageUrl(token, filename, bytes);
      } catch (err) {
        throw new Error(`image upload failed for ${src} (bytes=${bytes.length}): ${err?.message || err}`);
      }
      cache.set(hashHex, wxUrl);
      uploaded.push(wxUrl);
    }

    t.attrSet("src", wxUrl);
  }

  async function walk(ts) {
    for (const t of ts) {
      if (t.type === "image") await handleImageToken(t);
      if (t.children && t.children.length) await walk(t.children);
    }
  }

  await walk(tokens);
  return { tokens, uploaded };
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

function stripTaskListInputs(html) {
  return html.replace(/<input\b[^>]*type="checkbox"[^>]*>/gi, (m) => {
    const checked = /\bchecked\b/i.test(m);
    return checked ? "[x] " : "[ ] ";
  });
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function replaceTables(html) {
  return html.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const lines = rows.map((row) => {
      const cells = row.match(/<(?:th|td)[\s\S]*?<\/(?:th|td)>/gi) || [];
      return cells.map((c) => stripTags(c)).join(" | ");
    });
    if (lines.length === 0) return "";
    return `<p>${lines.join("<br>")}</p>`;
  });
}

function replaceHr(html) {
  return html.replace(/<hr\s*\/?>/gi, "");
}

function stripLinks(html) {
  return html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
}

function removeEmptyListItems(html) {
  return html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (m, body) => {
    const text = stripTags(body);
    return text ? m : "";
  });
}

function flattenListItemParagraphs(html) {
  return html.replace(/<li\b([^>]*)>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/gi, (m, attrs, body) => {
    return `<li${attrs}>${body}</li>`;
  });
}

function convertListsToParagraphs(html) {
  let out = html;
  out = out.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (m, list) => {
    const items = list.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
    const lines = items
      .map((li) => {
        const body = li.replace(/^<li\b[^>]*>|<\/li>$/gi, "").trim();
        const unwrapped = body.replace(/^\s*<p[^>]*>([\s\S]*?)<\/p>\s*$/i, "$1").trim();
        return unwrapped ? `<p>• ${unwrapped}</p>` : "";
      })
      .filter(Boolean);
    return lines.join("");
  });
  out = out.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (m, list) => {
    const items = list.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || [];
    const lines = items
      .map((li, i) => {
        const body = li.replace(/^<li\b[^>]*>|<\/li>$/gi, "").trim();
        const unwrapped = body.replace(/^\s*<p[^>]*>([\s\S]*?)<\/p>\s*$/i, "$1").trim();
        return unwrapped ? `<p>${i + 1}. ${unwrapped}</p>` : "";
      })
      .filter(Boolean);
    return lines.join("");
  });
  return out;
}

function convertHeadings(html) {
  let out = html;
  // drop H1 (主标题不要放正文)
  out = out.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi, "");
  out = out.replace(
      /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi,
      '<h2 style="padding:1px 12.5px;color:#fff;margin:1.2em 0 1em;border-radius:4px;display:inline-block;background-color:rgb(72,112,172);font-size:1.3em;visibility:visible;"><span leaf="" style="visibility:visible;">$1</span></h2>'
  );
  out = out.replace(
      /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi,
      '<h3 style="padding:0;color:rgb(72,112,172);margin:1.2em 0 1em;font-size:1.3em;"><span leaf="">$1</span></h3>'
  );
  return out;
}

function styleParagraphs(html) {
  let out = html;
  out = out.replace(/<p>/gi, '<p style="margin:10px 0;letter-spacing:0;word-break:break-word;line-height:1.75;color:#242424">');
  out = out.replace(/<blockquote>/gi, '<blockquote style="margin:12px 0;padding-left:12px;border-left:3px solid #e0e0e0;letter-spacing:0;word-break:break-word;color:#3a3a3a;line-height:1.75">');
  return out;
}

function applyTheme(html) {
  const bodyStyle =
      "color:#242424;padding:8px 0;line-height:1.75;font-size:17px;" +
      "font-family:'PingFang SC','Hiragino Sans GB','Helvetica Neue',Arial,sans-serif;word-break:break-word;";
  const linkStyled = html.replace(/<a\b([^>]*)>/gi, '<a $1 style="color:#576b95;font-weight:600;text-decoration:none">');
  const codeStyled = linkStyled
      .replace(/<code>/gi, '<code style="background:#f7f7f7;color:#202124;padding:2px 4px;border-radius:4px">')
      .replace(/<pre><code class="language-[^"]*">/gi, '<pre style="background:#f7f7f7;color:#202124;padding:12px;border-radius:8px;overflow:auto"><code>');
  return `<div style="${bodyStyle}">${codeStyled}</div>`;
}

async function cmdDraft(opts) {
  const { title, author, digest, mdFile, contentSourceUrl, thumbMediaId, digestAuto, digestN } = opts;
  if (!mdFile || !thumbMediaId) {
    console.error("missing required: --md-file, --thumb-media-id");
    process.exit(2);
  }

  const appid = mustEnv("WECHAT_MP_APPID");
  const secret = mustEnv("WECHAT_MP_APPSECRET");
  const token = await getAccessToken(appid, secret);

  const mdText = await fs.readFile(mdFile, "utf8");
  const baseDir = path.dirname(mdFile);

  const env = {};
  const tokens = md.parse(mdText, env);
  const { tokens: tokens2, uploaded } = await rewriteImageTokens({ token, tokens, baseDir });

  let finalTitle = (title || "").trim();
  if (!finalTitle) finalTitle = extractTitleFromMarkdown(mdText);
  if (!finalTitle) {
    console.error("missing title: provide --title or add a markdown title");
    process.exit(2);
  }

  let dg = (digest || "").trim();
  if (!dg && digestAuto) dg = autoDigestFromMarkdown(mdText, Number(digestN || 120));

  let contentHTML = md.renderer.render(tokens2, md.options, env);
  contentHTML = stripTaskListInputs(contentHTML);
  contentHTML = replaceTables(contentHTML);
  contentHTML = replaceHr(contentHTML);
  contentHTML = stripLinks(contentHTML);
  contentHTML = flattenListItemParagraphs(contentHTML);
  contentHTML = removeEmptyListItems(contentHTML);
  contentHTML = convertListsToParagraphs(contentHTML);
  contentHTML = convertHeadings(contentHTML);
  contentHTML = styleParagraphs(contentHTML);
  contentHTML = applyTheme(contentHTML);
  if (opts.dumpHtml) {
    console.log(contentHTML);
    return;
  }

  const draftReq = {
    articles: [
      {
        title: finalTitle,
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

  const preview = Array.from(mdText.trim()).slice(0, 200).join("") + (Array.from(mdText.trim()).length > 200 ? "..." : "");

  console.log("ok");
  console.log("draft_media_id:", dr.media_id);
  console.log("title:", finalTitle);
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
    .option("--title <title>", "article title (fallback to markdown title)")
    .requiredOption("--md-file <path>", "markdown file")
    .requiredOption("--thumb-media-id <id>", "thumb media_id")
    .option("--author <author>", "author")
    .option("--content-source-url <url>", "source url")
    .option("--digest <digest>", "digest")
    .option("--digest-auto", "auto generate digest from markdown", false)
    .option("--digest-n <n>", "digest length (runes)", "120")
    .option("--dump-html", "print rendered HTML and exit", false)
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
          dumpHtml: !!opts.dumpHtml,
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
