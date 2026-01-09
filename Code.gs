/**
 * APP: AI Strategy Room (AI会議室)
 * FILE: Code.gs
 * VERSION: v16.3.2-resetlog-thumb-01
 * DATE(JST): 2026-01-08 15:34 JST
 * TITLE: リセット白画面対策＋ログ復元＋HEICサムネ対応
 * CHANGES:
 * - runConferenceTurn: images を最大10枚に制限（slice(0,10)）
 * - 既存仕様（UI/返り値/Watchdog）は維持
 * AUTHOR: Rex / Yui (Integration)
 * BUILD_PARAM: ?b=2026-01-08_1115_imgbroadcast-01
 * DEBUG_PARAM: &debug=1
 */

const APP_NAME    = "AI Strategy Room";
const APP_VERSION = "v16.3.2-resetlog-thumb-01";
const BUILD_ID = "2026-01-08_1534_resetlog-thumb-01";
const AUTHOR      = "Rex / Yui (Integration)";

const SP = PropertiesService.getScriptProperties();
const GEMINI_API_KEY = SP.getProperty("GEMINI_API_KEY") || "";

const GEMINI_MODEL  = (SP.getProperty("GEMINI_MODEL") || "gemini-1.5-flash").trim().replace(/^models\//,"");
// ===== Web App Entry =====
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const debug = String(params.debug || "") === "1";
  const b = String(params.b || BUILD_ID);

  try {
    const template = _loadTemplateWithFallback_();
    template.APP_NAME = APP_NAME;
    template.APP_VERSION = APP_VERSION;
    template.BUILD_ID = b;
    template.AUTHOR = AUTHOR;
    template.DEBUG = debug;

    const evaluated = template.evaluate();
    let html = evaluated.getContent();

    if (debug) {
      html = _injectBeforeBodyEnd_(html, _debugBannerHtml_(b));
      html = _injectBeforeBodyEnd_(html, _blankWatchdogJs_());
    }

    return HtmlService.createHtmlOutput(html)
      .setTitle(`${APP_NAME} ${APP_VERSION}`)
      .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (err) {
    console.error("doGet fatal:", err && err.stack ? err.stack : err);
    const msg = (err && err.message) ? err.message : String(err);

    return HtmlService.createHtmlOutput(
      `<div style="font-family:system-ui, -apple-system, 'Segoe UI', sans-serif; padding:16px;">
        <h2 style="margin:0 0 8px; color:#b00020;">⚠ doGet エラー（画面が真っ白の原因）</h2>
        <div style="margin:10px 0; padding:10px; background:#f6f6f6; border:1px solid #ddd; white-space:pre-wrap;">${_escapeHtml_(msg)}</div>
        <p style="margin:10px 0 0; color:#444;">
          ここが出たら <b>Apps Script → 実行（時計）</b> で doGet の失敗ログを見ると、原因が確定します。
        </p>
      </div>`
    ).setTitle("System Error");
  }
}

function _loadTemplateWithFallback_() {
  try {
    return HtmlService.createTemplateFromFile("index");
  } catch (e1) {
    return HtmlService.createTemplateFromFile("Index");
  }
}

// ===== include =====
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    console.warn("include missing:", filename);
    return _fallbackInclude_(filename);
  }
}

function _fallbackInclude_(filename) {
  const safe = _escapeHtml_(String(filename || "unknown"));
  if (/\.(css)$/i.test(safe) || /css/i.test(safe)) {
    return (
      `/* MISSING INCLUDE: ${safe} */\n` +
      `/* 画面が隠れて真っ白になるのを防ぐ */\n` +
      `html, body { visibility: visible !important; opacity: 1 !important; }\n`
    );
  }
  if (/\.(js)$/i.test(safe) || /js/i.test(safe)) {
    return (
      `/* MISSING INCLUDE: ${safe} */\n` +
      `(function(){\n` +
      `  try{\n` +
      `    document.documentElement.style.visibility='visible';\n` +
      `    document.body && (document.body.style.visibility='visible');\n` +
      `    var d=document.createElement('div');\n` +
      `    d.style.cssText='position:fixed;left:0;right:0;top:0;z-index:99999;background:#b00020;color:#fff;padding:10px 12px;font:14px/1.3 system-ui';\n` +
      `    d.textContent='⚠ include欠品: ${safe}（この欠品が原因で真っ白になりやすい）';\n` +
      `    document.body ? document.body.appendChild(d) : document.documentElement.appendChild(d);\n` +
      `  }catch(e){}\n` +
      `})();\n`
    );
  }
  return `<!-- MISSING INCLUDE: ${safe} -->`;
}

// ===== AI機能（最低限：UIから呼ばれる口） =====
function getRoleAssignment(selectedMembers, mcName) {
  const members = (selectedMembers || []).filter(m => m && m !== mcName);
  const roles = {};
  const roleTypes = ["proposer", "opposer", "tech", "observer"];
  const shuffled = members.slice().sort(() => Math.random() - 0.5);

  shuffled.forEach((member, i) => roles[member] = roleTypes[i % roleTypes.length]);
  roles[mcName] = "mc";
  return roles;
}

/**
 * ★★★ 会議ターン実行（互換ラッパー付き）★★★
 * 
 * 【修正ポイント】
 * 1. 返り値を完全統一: {status:"success", response:"Markdown文字列", questionId:""}
 * 2. エラー時も必ず status:"success" で返す（UI側のPromiseチェーンを止めない）
 * 3. 引数の型違いを吸収（古いUI/新しいUIどちらでも動く）
 */
function runConferenceTurn(speaker, context, instruction, images, sessionId, title, role) {
  try {
    // ★引数の正規化（互換ラッパー）
    const _speaker = String(speaker || "unknown");
    const _context = String(context || "");
    const _instruction = String(instruction || "");
    const _imagesRaw = Array.isArray(images) ? images : [];
    // ★最大10枚ガード（事故防止）
    const _images = _imagesRaw.slice(0, 10);
    const _sessionId = String(sessionId || ("SESS_" + Date.now()));
    const _title = String(title || "無題");
    const _role = String(role || "observer");

    // システムプロンプト
    const sys = [
      `あなたはAI会議の参加者「${_speaker}」です。`,
      `役割: ${_roleDesc_(_role)}`,
      `出力はMarkdown。必要ならコードブロックも可。`
    ].join("\n");

    const user = `【Context】\n${_context}\n\n【Instruction】\n${_instruction}`;

    let responseText = "";

    // ★APIキー未設定時の自動応答
    if (!GEMINI_API_KEY) {
      responseText = _mockReply_(_speaker, _role) + "\n\n(※GEMINI_API_KEY 未設定のため自動応答)";
      _saveLog_(_sessionId, _title, _speaker, responseText);
      
      // ★必ず {status:"success", response:"...", questionId:""} 形式で返す
      return {
        status: "success",
        response: responseText,
        questionId: _sessionId
      };
    }

    // ★Gemini API呼び出し（エラー時も必ず自動応答で返す）
    try {
      responseText = _callGemini_(sys, user, _images);
    } catch (apiErr) {
      console.error("Gemini API error:", apiErr);
      // ★通信エラー時も自動応答で返す（会話を止めない）
      responseText = _mockReply_(_speaker, _role) + 
                     `\n\n(※通信エラーで自動応答に切替)\n詳細: ${apiErr.message || apiErr}`;
    }

    // ログ保存
    _saveLog_(_sessionId, _title, _speaker, responseText);

    // ★必ず {status:"success", response:"...", questionId:""} 形式で返す
    return {
      status: "success",
      response: responseText,
      questionId: _sessionId
    };

  } catch (err) {
    // ★システムエラー時も必ず {status:"success", response:"..."} で返す（停止防止）
    console.error("runConferenceTurn fatal error:", err);
    const fallbackResponse = `(システムエラー)\n${err.message || err}\n\n${_mockReply_(speaker || "AI", role || "observer")}`;
    
    return {
      status: "success",
      response: fallbackResponse,
      questionId: String(sessionId || "ERROR_SESS")
    };
  }
}

// ===== Logs =====
function getLogList() {
  // LOG_META が壊れていても “復元” して一覧を返す（過去ログが見えない対策）
  try {
    const meta = JSON.parse(SP.getProperty("LOG_META") || "[]");
    if (Array.isArray(meta)) return meta;
  } catch (e) {}

  try {
    return _rebuildLogMeta_();
  } catch (e2) {
    return [];
  }
}

function _rebuildLogMeta_() {
  const props = SP.getProperties();
  const items = [];

  Object.keys(props).forEach((k) => {
    if (k === "LOG_META") return;
    if (!k.startsWith("LOG_")) return;

    const sid = k.substring(4);
    let arr = null;
    try {
      arr = JSON.parse(props[k] || "[]");
    } catch (e) {
      arr = null;
    }

    if (Array.isArray(arr) && arr.length) {
      const last = arr[arr.length - 1] || {};
      items.push({
        id: sid,
        time: last.time || Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss"),
        title: "(復元)"
      });
    }
  });

  // 新しい順（time は文字列前提）
  items.sort((a, b) => String(b.time).localeCompare(String(a.time)));

  const out = items.slice(0, 20);
  try {
    SP.setProperty("LOG_META", JSON.stringify(out));
  } catch (e) {}
  return out;
}


function getSessionLogs(id) {
  try {
    return JSON.parse(SP.getProperty("LOG_" + id) || "[]");
  } catch (e) {
    return [];
  }
}

function deleteLog(id) {
  try {
    SP.deleteProperty("LOG_" + id);
    const meta = JSON.parse(SP.getProperty("LOG_META") || "[]").filter(m => m.id !== id);
    SP.setProperty("LOG_META", JSON.stringify(meta));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

function uploadToGithub(filename, contentString) {
  return `GitHub Upload Simulation: ${filename}`;
}

// ===== Internal: Gemini Call =====
function _callGemini_(systemText, userText, images) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const parts = [{ text: systemText + "\n\n" + userText }];

  (images || []).forEach(dataUri => {
    try {
      const mime = String(dataUri).split(";")[0].split(":")[1] || "image/jpeg";
      const base64 = String(dataUri).split(",")[1] || "";
      if (!base64) return;
      parts.push({ inline_data: { mime_type: mime, data: base64 } });
    } catch (e) {}
  });

  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ]
  };

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const raw = res.getContentText();
  const json = JSON.parse(raw);

  if (json.error) throw new Error(json.error.message || "Gemini error");
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Response");
  return text;
}

// ===== Internal: Log Save =====
function _saveLog_(sessionId, title, speaker, content) {
  try {
    const sid = String(sessionId || ("SESS_" + Date.now()));
    const key = "LOG_" + sid;
    const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");

    let logs = [];
    try { logs = JSON.parse(SP.getProperty(key) || "[]"); } catch (e) {}
    logs.push({ speaker, content, time: now });

    const MAX = 40;
    if (logs.length > MAX) logs = logs.slice(logs.length - MAX);

    SP.setProperty(key, JSON.stringify(logs));

    let meta = [];
    try { meta = JSON.parse(SP.getProperty("LOG_META") || "[]"); } catch (e) {}
    if (!meta.find(m => m.id === sid)) {
      meta.unshift({ id: sid, time: now, title: title || "無題" });
      if (meta.length > 20) meta = meta.slice(0, 20);
      SP.setProperty("LOG_META", JSON.stringify(meta));
    }
  } catch (e) {
    console.warn("saveLog skipped:", e);
  }
}

// ===== Internal: Helpers =====
function _roleDesc_(role) {
  switch (role) {
    case "mc": return "司会。論点整理と結論の取りまとめ。";
    case "proposer": return "提案者。具体案を前向きに提示。";
    case "opposer": return "反論者。弱点・リスクを指摘して深掘り。";
    case "tech": return "技術。実現可能性、品質、注意点を検証。";
    default: return "観察。客観視点で補足。";
  }
}

function _mockReply_(speaker, role) {
  return `**${speaker}**（${role || "observer"}）です。\n現状はサーバー側の安全運転モードで返しています。`;
}

function _escapeHtml_(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function _injectBeforeBodyEnd_(html, inject) {
  const s = String(html || "");
  if (s.includes("</body>")) return s.replace("</body>", inject + "\n</body>");
  return s + "\n" + inject;
}

function _debugBannerHtml_(b) {
  return `
<div id="__debugBanner" style="position:fixed;left:0;right:0;top:0;z-index:99999;background:#111;color:#fff;padding:8px 10px;font:12px/1.3 system-ui;opacity:.92">
  <b>${_escapeHtml_(APP_NAME)}</b> ${_escapeHtml_(APP_VERSION)} ｜ BUILD=${_escapeHtml_(b)} ｜ AUTHOR=${_escapeHtml_(AUTHOR)} ｜ debug=1
</div>
<div style="height:34px"></div>`;
}

function _blankWatchdogJs_() {
  return `
<script>
(function(){
  function isBlank(){
    try{
      var b=document.body;
      if(!b) return true;
      var txt=(b.innerText||"").trim();
      var hasEl=b.querySelector && b.querySelector("button, input, textarea, .card, .panel, header, main, nav");
      return (!hasEl && txt.length < 5);
    }catch(e){ return false; }
  }
  window.addEventListener("load", function(){
    if(!isBlank()) return;
    try{
      document.documentElement.style.visibility="visible";
      document.body.style.visibility="visible";
      var d=document.createElement("div");
      d.style.cssText="position:fixed;left:12px;right:12px;top:52px;z-index:99999;background:#b00020;color:#fff;padding:10px 12px;border-radius:10px;font:14px/1.4 system-ui";
      d.innerHTML="⚠ 画面が真っ白判定です。<br>多い原因：<b>include先(JS/CSS)欠品</b>／<b>index(Index)名違い</b>／<b>デプロイ反映ズレ</b>。<br>Apps Scriptの<b>実行（時計）</b>で doGet を確認してね。";
      document.body.appendChild(d);
    }catch(e){}
  });
})();
</script>`;
}
