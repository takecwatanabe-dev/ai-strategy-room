/**
 * APP: AI Strategy Room
 * FILE: Code.gs (Server-side)
 * VERSION: v0.2.9-fix-history-bug
 * BUILD: 2025-12-20_0145_fix-foreach-error
 * * 【統合版】v0.2.8機能 + GitHub連携(Code Sync) + バグ修正
 * * 【修正情報】
 * 修正日時: 2025-12-20 01:45:00 JST
 * 修正AI: Gemini (ジェミニ)
 * AI種類: Google Gemini 2.0 Flash Exp
 * 修正内容: 
 * - GitHub連携機能の実装 (@codeコマンドでコード参照)
 * - 履歴データの展開ロジック修正 (hist.forEachエラーの解消)
 * - AIモデル名の判定ロジック修正 (大文字・小文字の区別を撤廃)
 */

// --- 設定・定数 ---
const VER = "v0.2.9-fix-history-bug";
const FOLDER_NAME = "AI_Strategy_Room_Images";

// ペルソナ定義（システムプロンプト）
const PERSONA_YUI = `あなたは「AI Strategy Room」の秘書兼ファシリテーター、Yuiです。丁寧で親しみやすい口調（〜ですね、〜しましょう）で話します。ユーザー（ナベさん）の意図を汲み取り、議論を整理し、具体的で前向きな次のアクションを提案してください。`;
const PERSONA_REX = `お前は「AI Strategy Room」のレッドチーム（批判的アドバイザー）、Rexだ。断定的で簡潔な口調（〜だ、〜はずだ）で話せ。馴れ合いは不要。ユーザーの提案や他AIの意見に対し、論理的な欠陥、リスク、楽観的すぎる前提を容赦なく指摘し、強固な戦略へ導け。ただし人格攻撃はせず、あくまで論点に対する指摘に留めろ。`;
const PERSONA_GEMINI = `私はGoogleのAI、Geminiです。論理的・分析的な口調（〜と考えられます、〜の可能性があります）で話します。感情を交えず、情報を網羅的に分析し、複数の観点（メリット・デメリット・数値的根拠）から構造化された回答を提供してください。`;

// --- メイン処理 ---

function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(`AI Strategy Room ${VER}`)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 権限チェック (Best Effort)
 */
function initAuth() {
  console.log("Auth Check...");
  try { DriveApp.getStorageUsed(); } catch(e) {}
  try { UrlFetchApp.fetch("https://www.google.com"); } catch(e) {}
  console.log("Auth Check Done (Best Effort)");
}

/**
 * クライアントからのメイン呼び出し
 */
function runRelay(theme, imagesBase64, aiModel, historyPayload) {
  // 1. 画像保存（Safe Mode）
  let driveLinks = [];
  try {
    if (imagesBase64 && imagesBase64.length > 0) {
      driveLinks = saveImagesToDriveSafe(theme, imagesBase64);
    }
  } catch (e) {
    console.warn("Drive Save Skipped: " + e.message);
  }

  // 2. CODE SYNC: GitHub連携
  let augmentedTheme = theme;
  let systemNotice = "";
  
  if (theme.includes("@code") || theme.includes("@c ")) {
    try {
      const codeData = fetchGithubCodeByCommand(theme);
      if (codeData) {
        augmentedTheme = `${theme}\n\n--- 📎 REFERENCE CODE (GitHub: ${codeData.path}) ---\n${codeData.content}\n--- END CODE ---`;
        systemNotice = `(GitHub: ${codeData.path} を参照しました)`;
      }
    } catch (e) {
      systemNotice = `(GitHub取得エラー: ${e.message})`;
    }
  }

  // 3. AI生成
  let responseText = "";
  try {
    responseText = callAIWithHistory(augmentedTheme, imagesBase64, aiModel, historyPayload);
    if (systemNotice) {
      responseText = systemNotice + "\n\n" + responseText;
    }
  } catch (e) {
    return { status: "error", message: "AI Error: " + e.message, ver: VER };
  }

  return { status: "success", driveLinks: driveLinks, response: responseText, ver: VER };
}

/**
 * GitHubコード取得ロジック
 */
function fetchGithubCodeByCommand(text) {
  const regex = /@(code|c)\s+(file|full)\s+([\w\.-]+)/i;
  const match = text.match(regex);
  
  if (!match) return null;

  const mode = match[2].toLowerCase();
  const filename = match[3];

  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN');
  const owner = props.getProperty('GITHUB_OWNER');
  const repo = props.getProperty('GITHUB_REPO');

  if (!token || !owner || !repo) {
    throw new Error("GitHub設定不足: スクリプトプロパティを確認してください");
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filename}`;
  const options = {
    method: "get",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github.v3.raw"
    },
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() !== 200) {
    throw new Error(`File not found or API Error (${res.getResponseCode()})`);
  }

  let content = res.getContentText();
  const MAX_CHARS = (mode === 'full') ? 20000 : 3000;
  
  if (content.length > MAX_CHARS) {
    content = content.substring(0, MAX_CHARS) + `\n\n... (以下省略: サイズが大きいため先頭 ${MAX_CHARS} 文字のみ読み込みました)`;
  }

  return { path: filename, content: content };
}


/**
 * AI呼び出し分岐（履歴オブジェクト解析修正版）
 */
function callAIWithHistory(prompt, images, model, historyPayload) {
  const props = PropertiesService.getScriptProperties();
  
  // モデル名を小文字に統一
  const m = model.toLowerCase();

  // ★修正ポイント：履歴オブジェクトから、このAI用の配列を正しく取り出す
  let hist = [];
  if (historyPayload && historyPayload.perAIHistory && historyPayload.perAIHistory[m]) {
    hist = historyPayload.perAIHistory[m];
  } else if (Array.isArray(historyPayload)) {
    // 万が一、配列が直接来た場合の保険
    hist = historyPayload;
  }

  // --- Yui (OpenAI) ---
  if (m === 'yui') {
    const apiKey = props.getProperty('OPENAI_API_KEY');
    if (!apiKey) throw new Error("OpenAI API Key not set.");
    
    let messages = [{ role: "system", content: PERSONA_YUI }];
    hist.forEach(h => messages.push({ role: h.role, content: h.content }));
    
    if (images && images.length > 0) {
      let contentParts = [{ type: "text", text: prompt }];
      images.forEach(img => {
        contentParts.push({ type: "image_url", image_url: { url: img } });
      });
      messages.push({ role: "user", content: contentParts });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const url = "https://api.openai.com/v1/chat/completions";
    const payload = {
      model: "gpt-4o",
      messages: messages,
      temperature: 0.3
    };
    return fetchApi(url, apiKey, payload, "Bearer");
  }

  // --- Rex (Claude) ---
  if (m === 'rex') {
    const apiKey = props.getProperty('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error("Anthropic API Key not set.");

    let messages = [];
    hist.forEach(h => messages.push({ role: h.role, content: h.content }));

    if (images && images.length > 0) {
      let contentParts = images.map(img => ({
        type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.split(',')[1] }
      }));
      contentParts.unshift({ type: "text", text: prompt });
      messages.push({ role: "user", content: contentParts });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const url = "https://api.anthropic.com/v1/messages";
    const payload = {
      model: "claude-3-5-sonnet-20241022",
      system: PERSONA_REX,
      messages: messages,
      max_tokens: 1500,
      temperature: 0.4
    };
    return fetchApi(url, apiKey, payload, "x-api-key");
  }

  // --- Gemini (Google) ---
  if (m === 'gemini') {
    const apiKey = props.getProperty('GEMINI_API_KEY');
    if (!apiKey) throw new Error("Gemini API Key not set.");

    let modelName = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    modelName = modelName.replace(/^models\//, '').trim();

    let contents = [];
    hist.forEach(h => {
      let role = (h.role === 'user') ? 'user' : 'model';
      contents.push({ role: role, parts: [{ text: h.content }] });
    });

    let parts = [{ text: prompt }];
    if (images && images.length > 0) {
      images.forEach(img => {
        parts.push({ inline_data: { mime_type: "image/jpeg", data: img.split(',')[1] } });
      });
    }
    contents.push({ role: "user", parts: parts });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const payload = {
      system_instruction: { parts: [{ text: PERSONA_GEMINI }] },
      contents: contents,
      generationConfig: { temperature: 0.3 }
    };

    return fetchGeminiWithRetry(url, payload);
  }

  return "Error: Unknown Model Selected (" + model + ")";
}

// --- 共通Fetch関数 ---
function fetchApi(url, token, payload, authType) {
  const options = {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: {}
  };
  if (authType === "Bearer") options.headers["Authorization"] = "Bearer " + token;
  if (authType === "x-api-key") options.headers["x-api-key"] = token;
  if (url.includes("anthropic")) options.headers["anthropic-version"] = "2023-06-01";

  options.payload = JSON.stringify(payload);
  const res = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(res.getContentText());

  if (res.getResponseCode() !== 200) throw new Error(`API Error: ${JSON.stringify(json)}`);

  if (url.includes("openai")) return json.choices[0].message.content;
  if (url.includes("anthropic")) return json.content[0].text;
  return JSON.stringify(json);
}

// --- Gemini 503 Retry ---
function fetchGeminiWithRetry(url, payload) {
  const maxRetries = 3;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const res = UrlFetchApp.fetch(url, {
        method: "post", contentType: "application/json", muteHttpExceptions: true, payload: JSON.stringify(payload)
      });
      if (res.getResponseCode() === 200) {
        return JSON.parse(res.getContentText()).candidates?.[0]?.content?.parts?.[0]?.text || "(No content)";
      }
      if (res.getResponseCode() === 503 || res.getContentText().includes("UNAVAILABLE")) {
        Utilities.sleep((++attempt) * 1500);
        continue;
      }
      throw new Error(`Gemini Error: ${res.getContentText()}`);
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      attempt++;
      Utilities.sleep(1000);
    }
  }
}

// --- Drive保存 (Safe Mode) ---
function saveImagesToDriveSafe(theme, imagesBase64) {
  let folder;
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  if (it.hasNext()) {
    folder = it.next();
  } else {
    folder = DriveApp.createFolder(FOLDER_NAME);
  }
  
  const dateStr = Utilities.formatDate(new Date(), "JST", "yyyyMMdd_HHmmss");
  return imagesBase64.map((b64, i) => {
    let blob = Utilities.newBlob(Utilities.base64Decode(b64.split(',')[1]), "image/jpeg", `${dateStr}_${i+1}.jpg`);
    return folder.createFile(blob).getUrl();
  });
}