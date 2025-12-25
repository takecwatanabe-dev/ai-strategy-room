/**
 * APP: AI Strategy Room
 * FILE: Code.gs
 * VERSION: v5.12.7-stable-dir
 * BUILD: 2025-12-25_1100_dir
 * AUTHOR: Rex
 *
 * TITLE: @code コマンドのディレクトリ対応・list <path>対応・repo切替対応
 * CODING_TIME(JST): 2025-12-25 11:00 JST
 *
 * CHANGES:
 * - New: @code <path> でディレクトリとファイルを自動判別（配列ならディレクトリ一覧、ファイルならdownload_url取得）
 * - New: @code list <path> で任意フォルダの一覧を出せるようにする
 * - New: @repo owner/repo でリポジトリ切替に対応
 * - New: @code owner/repo:path のワンショット指定に対応
 * - Fix: Code.gs → コード.gs のフォールバックが動作しない問題を修正（前回の修正を維持）
 *
 * BuildParam(b): ?b=2025-12-25_1100_dir
 * DebugParam: &debug=1
 * POLICY: UI変更禁止。エラー時は安定優先。
 */

// ▼▼ 設定エリア ▼▼
const APP_VERSION = 'v5.12.7-stable-dir';
const BUILD_ID = '2025-12-25_1100_dir';
const AUTHOR = 'Rex';
const BUILD_JST = '2025-12-25 11:00 JST';

const VER = APP_VERSION;
const FOLDER_NAME = "AI_Strategy_Room_Images"; // 画像保存先フォルダ
const LOG_SHEET_NAME = "AI_Strategy_Room_Log"; // ログ保存先シート名
const MAX_LOG_TITLES = 100; // 最大100タイトル保存
const MAX_IMAGE_SIZE_MB = 4; // 画像サイズ制限（MB）※API上限5MBに対し余裕を持たせる

// 共通プロンプト（出力形式の統一）
const COMMON_INSTRUCTION = `
【重要: 出力形式の厳守】
1. 回答の冒頭に、必ず議論の「短いタイトル（20文字以内）」を **### タイトル** 形式で出力すること。
2. コードを出力する際は、必ずMarkdownのコードブロック（\`\`\`言語名 ... \`\`\`）で囲むこと。
`;

// ペルソナ定義
const PERSONA_YUI = `あなたは「AI Strategy Room」の秘書兼ファシリテーター、Yuiです。丁寧で親しみやすい口調で話します。${COMMON_INSTRUCTION}`;
const PERSONA_REX = `お前は「AI Strategy Room」のレッドチーム、Rexだ。断定的で簡潔に話せ。批判的視点を持て。${COMMON_INSTRUCTION}`;
const PERSONA_GEMINI = `私はGoogleのAI、Geminiです。論理的・分析的に話します。${COMMON_INSTRUCTION}`;
// ▲▲ 設定エリア ▲▲

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('index');

  const now = new Date();
  const nowJstStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');

  t.APP_VERSION = APP_VERSION;
  t.VERSION = APP_VERSION;
  t.BUILD_ID = BUILD_ID;
  t.BUILD = BUILD_ID;
  t.NOW_JST = nowJstStr;
  t.AUTHOR = AUTHOR;
  t.BUILD_JST = BUILD_JST;

  return t.evaluate()
    .setTitle(`AI Strategy Room ${VER}`)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
}

// ユーザーの行動ログ記録
function logUserAction(sessionId, theme, title) {
  try { logToSheet(sessionId, "User", theme, title || "（タイトル未定）"); } catch(e) {}
}

// メイン処理：AIへのリレー
function runRelay(theme, title, imagesBase64, aiModel, historyPayload, sessionId) {
  // 1. 画像サイズチェック（ガード処理）
  if (imagesBase64 && imagesBase64.length > 0) {
    const sizeCheck = validateImageSize(imagesBase64);
    if (!sizeCheck.ok) {
      const errorMsg = `⚠️ **画像エラー**: 送信された画像が大きすぎます（${sizeCheck.sizeMB}MB）。AIが処理できるのは約${MAX_IMAGE_SIZE_MB}MBまでです。画像を縮小して再送信してください。 (${APP_VERSION} / b=${BUILD_ID})`;
      logToSheet(sessionId, aiModel, errorMsg, title);
      return { status: "success", response: errorMsg, ver: VER, appVersion: APP_VERSION, buildId: BUILD_ID };
    }
    // 画像があればドライブに保存
    try { saveImagesToDriveSafe(theme, imagesBase64); } catch (e) {}
  }

  // 2. CONTEXT構築（過去ログ参照）
  let contextText = "";
  try {
    const sessionLogs = getSessionLogs(sessionId);
    if (sessionLogs && sessionLogs.length > 0) {
      let firstQuestion = null;
      for (let i = 0; i < sessionLogs.length; i++) {
        if (sessionLogs[i].speaker === "User") { firstQuestion = sessionLogs[i].content; break; }
      }

      let recentContext = [];
      for (let i = sessionLogs.length - 1; i >= 0; i--) {
        if (sessionLogs[i].speaker === "User" || sessionLogs[i].speaker === aiModel) {
          recentContext.unshift(sessionLogs[i]);
          if (recentContext.length >= 4) break;
        }
      }

      contextText = "【過去の会話（CONTEXT - 非表示）】\n\n";
      if (firstQuestion) {
        const truncated = firstQuestion.length > 800 ? firstQuestion.substring(0, 800) + '...' : firstQuestion;
        contextText += `最初の質問: ${truncated}\n\n`;
      }
      if (recentContext.length > 0) {
        contextText += "直近の会話:\n";
        const limitedContext = recentContext.slice(-2);
        limitedContext.forEach(log => {
          contextText += `[${log.time}] ${log.speaker}: ${log.content}\n\n`;
        });
      }
      contextText += "【CONTEXT終了】\n\n";
    }
  } catch (e) {}

  let finalPrompt = "";
  if (contextText) finalPrompt += contextText;

  finalPrompt += "【重要指示】\n";
  finalPrompt += "- 過去内容の繰り返しを禁止します。\n";
  finalPrompt += "- 出力は「今回の追加／変更点」中心にしてください。\n";
  finalPrompt += "- 以下の形式で出力してください：\n";
  finalPrompt += "  ### タイトル\n";
  finalPrompt += "  #### 追加/変更点（ここに差分を箇条書き）\n";
  finalPrompt += "  （必要なら）#### 補足（最小限）\n";
  finalPrompt += "【指示終了】\n\n";

  // ★新機能：@code / @c コマンドでGitHubからコードを取得（複数対応）★
  let githubCodeInfo = "";
  let githubCodeLoaded = false;
  let systemMessages = []; // System行を収集（画面に確実に表示するため）
  
  try {
    const githubCodeResults = fetchGithubCodeByCommand(theme);
    if (githubCodeResults.length > 0) {
      let hasSuccess = false;
      let codeBlocks = [];
      let errorMessages = [];
      
      githubCodeResults.forEach(result => {
        if (result.success) {
          codeBlocks.push(result.code);
          hasSuccess = true;
          
          // ★検証情報：path, length, sha256をSystem行として出力（切り捨て発生時はtrunc=1 shown=xxxxxも追加）★
          // 一覧の場合はitemCountを表示、ファイルの場合はsha256を表示
          // ★修正：実際に取得できたpathを表示（actualPathがあればそれを使用）★
          let verifyInfo;
          if (result.isList) {
            const listPath = result.path === '' || result.path === 'list' || result.path === 'ls' || result.path === '.' || result.path === '/' || result.path === '//' ? '/' : result.path;
            verifyInfo = `【System】GitHub LIST path=${listPath} items=${result.itemCount}`;
          } else {
            // ★修正：actualPathがあれば実際に取得できたpathを表示、なければ要求されたpathを表示★
            const displayPath = result.actualPath || result.path;
            verifyInfo = `【System】GitHub OK ${displayPath} len=${result.length} sha256=${result.sha256}`;
            if (result.truncated) {
              verifyInfo += ` trunc=1 shown=${result.shownLen}`;
            }
          }
          finalPrompt += `\n${verifyInfo}\n`;
          systemMessages.push(verifyInfo); // System行を収集
        } else if (result.error) {
          errorMessages.push(result.error);
        }
      });
      
      if (codeBlocks.length > 0) {
        finalPrompt += `\n\n【GitHubから取得したコード】\n${codeBlocks.join('\n\n')}\n\n`;
        githubCodeLoaded = true;
        githubCodeInfo = " (GitHub Code Loaded)";
      }
      
      if (errorMessages.length > 0) {
        errorMessages.forEach(error => {
          const systemError = `【System】${error}`;
          finalPrompt += `\n\n${systemError}\n\n`;
          systemMessages.push(systemError); // System行を収集
        });
      }
    }
  } catch (e) {
    // エラー時は握りつぶさず、Systemメッセージとして追加
    const systemError = `【System】GitHub Code Fetch Error: ${String(e && e.message ? e.message : e)}`;
    finalPrompt += `\n\n${systemError}\n\n`;
    systemMessages.push(systemError); // System行を収集
  }

  if (title && title.trim() !== "") finalPrompt += `【議題: ${title}】\n\n${theme}`;
  else finalPrompt += `${theme}\n\n(※この議論のタイトルを **### タイトル** の形式で冒頭に付けてください)`;

  let responseText = "";
  try {
    responseText = callAIWithHistory(finalPrompt, imagesBase64, aiModel, historyPayload);
    logToSheet(sessionId, aiModel, responseText, title || "（AI生成中）");
  } catch (e) {
    responseText = makeFriendlyErrorMessage(String(e && e.message ? e.message : e));
    logToSheet(sessionId, aiModel, "ERROR: " + String(e && e.message ? e.message : e), title);
  }

  // ★System行をAIの返答の前に前置きして、画面に確実に表示する★
  if (systemMessages.length > 0) {
    const systemPrefix = systemMessages.join('\n') + '\n\n';
    responseText = systemPrefix + responseText;
  }

  return { status: "success", response: responseText, ver: VER + githubCodeInfo, appVersion: APP_VERSION, buildId: BUILD_ID };
}

// ログ保存機能（appVersion/buildIdも保存）
function logToSheet(sessionId, speaker, content, title) {
  const files = DriveApp.getFilesByName(LOG_SHEET_NAME);
  let sheet;
  if (files.hasNext()) sheet = SpreadsheetApp.open(files.next()).getSheets()[0];
  else {
    const ss = SpreadsheetApp.create(LOG_SHEET_NAME);
    sheet = ss.getSheets()[0];
    sheet.appendRow(["Timestamp", "Session ID", "Title", "Speaker", "Content", "AppVersion", "BuildId"]);
  }

  sheet.appendRow([new Date(), sessionId, title ? title : "（タイトル未定）", speaker, content, APP_VERSION, BUILD_ID]);

  const lastRow = sheet.getLastRow();
  if (lastRow > MAX_LOG_TITLES + 1) {
    const rowsToDelete = lastRow - (MAX_LOG_TITLES + 1);
    sheet.deleteRows(2, rowsToDelete);
  }
}

// 過去ログ取得（最新10件）
function getLogList() {
  try {
    const files = DriveApp.getFilesByName(LOG_SHEET_NAME);
    if (!files.hasNext()) return [];
    const sheet = SpreadsheetApp.open(files.next()).getSheets()[0];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const maxRows = Math.min(lastRow - 1, MAX_LOG_TITLES);
    const startRow = Math.max(2, lastRow - maxRows + 1);
    const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, 3).getValues();

    const sessions = {};
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const sessId = row[1];

      let timestamp;
      if (row[0] instanceof Date) timestamp = row[0].getTime();
      else {
        const d = new Date(row[0]);
        if (isNaN(d.getTime())) continue;
        timestamp = d.getTime();
      }

      if (!sessions[sessId] || timestamp > sessions[sessId].timestamp) {
        const dateObj = new Date(timestamp);
        sessions[sessId] = {
          timestamp: timestamp,
          time: Utilities.formatDate(dateObj, "Asia/Tokyo", "MM/dd HH:mm"),
          title: row[2] || "(無題)",
          id: sessId
        };
      }
    }

    const result = Object.values(sessions).sort((a, b) => b.timestamp - a.timestamp);
    return result.slice(0, 10);
  } catch (e) { return []; }
}

// ログ削除
function deleteLog(sessionId) {
  try {
    const files = DriveApp.getFilesByName(LOG_SHEET_NAME);
    if (!files.hasNext()) return { success: false, message: "ログが見つかりません" };
    const sheet = SpreadsheetApp.open(files.next()).getSheets()[0];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "ログがありません" };

    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    const rowsToDelete = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][1]) === String(sessionId)) rowsToDelete.push(i + 2);
    }
    for (let i = rowsToDelete.length - 1; i >= 0; i--) sheet.deleteRow(rowsToDelete[i]);

    return { success: true, message: "ログを削除しました" };
  } catch (e) {
    return { success: false, message: "削除中にエラーが発生しました: " + e.toString() };
  }
}

function getSessionLogs(sessionId) {
  const files = DriveApp.getFilesByName(LOG_SHEET_NAME);
  if (!files.hasNext()) return [];
  const sheet = SpreadsheetApp.open(files.next()).getSheets()[0];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const logs = [];
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][1]) === String(sessionId)) {
      logs.push({
        time: Utilities.formatDate(new Date(data[i][0]), "Asia/Tokyo", "HH:mm"),
        speaker: data[i][3],
        content: data[i][4],
        title: data[i][2]
      });
    }
  }
  return logs;
}

// エラーメッセージ整形（末尾に版情報）
function makeFriendlyErrorMessage(rawError) {
  const versionInfo = ` (${APP_VERSION} / b=${BUILD_ID})`;
  const msg = String(rawError || "");
  if (msg.includes("Overloaded") || msg.includes("503")) return "⚠️ **混雑中**: AIサーバーが混み合っています。少し待って再試行してください。" + versionInfo;
  if (msg.includes("Quota") || msg.includes("429")) return "⚠️ **制限超過**: 短時間の利用制限にかかりました。またはモデルが無料枠に対応していません。" + versionInfo;
  if (msg.includes("Key not set") || msg.includes("null") || msg.includes("401")) return "⚠️ **設定エラー**: APIキー設定を確認してください。" + versionInfo;
  return `⚠️ **エラー**: ${msg}${versionInfo}`;
}

// API呼び出し
function callAIWithHistory(prompt, images, model, historyPayload) {
  const props = PropertiesService.getScriptProperties();
  const m = String(model || "").toLowerCase();
  let hist = historyPayload && historyPayload.perAIHistory && historyPayload.perAIHistory[m] ? historyPayload.perAIHistory[m] : [];

  if (m === 'yui') {
    const apiKey = props.getProperty('OPENAI_API_KEY');
    if (!apiKey) throw new Error("OpenAI API Key not set");
    let messages = [{ role: "system", content: PERSONA_YUI }, ...hist];
    if (images && images.length) {
      let content = [{ type: "text", text: prompt }];
      images.forEach(img => content.push({ type: "image_url", image_url: { url: img } }));
      messages.push({ role: "user", content: content });
    } else {
      messages.push({ role: "user", content: prompt });
    }
    return fetchApi(
      "https://api.openai.com/v1/chat/completions",
      apiKey,
      { model: "gpt-4o", messages: messages, temperature: 0.3 },
      "Bearer",
      "openai"
    );
  }

  if (m === 'rex') {
    const apiKey = props.getProperty('ANTHROPIC_API_KEY') || props.getProperty('CLAUDE_API_KEY');
    if (!apiKey) throw new Error("Anthropic/Claude API Key not set");
    let messages = [...hist];
    if (images && images.length) {
      let content = [];
      images.forEach(img => {
        const match = String(img).match(/^data:(.+);base64,(.+)$/);
        content.push({ type: "image", source: { type: "base64", media_type: match ? match[1] : "image/jpeg", data: match ? match[2] : String(img) } });
      });
      content.push({ type: "text", text: prompt });
      messages.push({ role: "user", content: content });
    } else {
      messages.push({ role: "user", content: prompt });
    }
    return fetchApi(
      "https://api.anthropic.com/v1/messages",
      apiKey,
      { model: "claude-3-haiku-20240307", system: PERSONA_REX, messages: messages, max_tokens: 1500 },
      "x-api-key",
      "anthropic"
    );
  }

  if (m === 'gemini') {
    let apiKey = props.getProperty('GEMINI_API_KEY') || props.getProperty('GOOGLE_API_KEY');
    if (!apiKey) throw new Error("Gemini/Google API Key not set");

    let contents = hist.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] }));
    let parts = [{ text: prompt }];

    if (images && images.length) {
      images.forEach(img => {
        const match = String(img).match(/^data:(.+);base64,(.+)$/);
        parts.push({ inline_data: { mime_type: match ? match[1] : "image/jpeg", data: match ? match[2] : String(img) } });
      });
    }
    contents.push({ role: "user", parts: parts });

    // ★修正: キャッシュを使わず、プロパティを正として取得。なければ1.5-flash
    let modelName = props.getProperty('GEMINI_MODEL') || 'gemini-1.5-flash';

    return fetchGeminiWithRetry(contents, apiKey, modelName);
  }

  return "Error: Unknown Model";
}

function fetchApi(url, token, payload, authType, serviceName) {
  const headers = {};
  if (authType === "Bearer") headers["Authorization"] = "Bearer " + token;
  else headers["x-api-key"] = token;
  if (serviceName === "anthropic") headers["anthropic-version"] = "2023-06-01";

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const txt = res.getContentText();
  const code = res.getResponseCode();
  const json = txt ? JSON.parse(txt) : {};

  if (code !== 200) throw new Error(json.error && json.error.message ? json.error.message : txt);
  return serviceName === "openai" ? json.choices[0].message.content : json.content[0].text;
}

// Gemini呼び出し（リトライ＆フォールバック強化版）
function fetchGeminiWithRetry(contents, apiKey, preferredModel) {
  // 試行するモデルのリスト。最初は希望モデル、ダメなら安定版(1.5-flash)
  const modelsToTry = [preferredModel];
  if (preferredModel !== 'gemini-1.5-flash') {
    modelsToTry.push('gemini-1.5-flash');
  }

  let lastError = null;

  for (const modelName of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const payload = {
      system_instruction: { parts: [{ text: PERSONA_GEMINI }] },
      contents: contents
    };

    try {
      const res = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const responseCode = res.getResponseCode();

      // 成功 (200 OK)
      if (responseCode === 200) {
        const json = JSON.parse(res.getContentText());
        return json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts
          ? (json.candidates[0].content.parts[0].text || "(No content)")
          : "(No content)";
      }

      // エラー発生時
      lastError = `HTTP ${responseCode}: ${res.getContentText()}`;
      // 404(Not Found)や429(Quota)なら、ループを回って次のモデル(1.5-flash)を試す
      // それ以外のエラー(500など)も念のため次を試す

    } catch (e) {
      lastError = String(e);
    }
  }

  // 全モデル失敗した場合
  throw new Error(`Gemini API Error (All attempts failed): ${lastError}`);
}

// ★修正：ファイル名から別名候補を生成（Code.gs⇔コード.gs、双方向対応）★
function generateFallbackPaths(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return [];
  }
  
  // パスをディレクトリとファイル名に分割
  const pathParts = filePath.split('/');
  const fileName = pathParts[pathParts.length - 1];
  const dirPath = pathParts.slice(0, -1).join('/');
  
  const fallbacks = [];
  
  // ファイル名の別名候補を生成
  // Code.gs → [コード.gs, code.gs]
  // コード.gs → [Code.gs, code.gs]
  // code.gs → [Code.gs, コード.gs]
  const extMatch = fileName.match(/^(.+)(\.[^.]+)$/);
  if (extMatch) {
    const baseName = extMatch[1];
    const ext = extMatch[2];
    
    // ★修正：固定マップ：Code ⇔ コード（双方向対応）★
    const nameMap = {
      'Code': ['コード', 'code'],
      'コード': ['Code', 'code'],
      'code': ['Code', 'コード']
    };
    
    if (nameMap[baseName]) {
      // ★修正：別名候補を順に追加（優先順位：コード → code）★
      nameMap[baseName].forEach(altName => {
        const altFileName = altName + ext;
        const altPath = dirPath ? `${dirPath}/${altFileName}` : altFileName;
        if (altPath !== filePath) {
          fallbacks.push(altPath);
        }
      });
    } else {
      // 固定マップに無い場合は大小文字のバリエーションを試す
      // 先頭が大文字の場合は小文字版を追加
      if (baseName.charAt(0).toUpperCase() === baseName.charAt(0)) {
        const lowerName = baseName.charAt(0).toLowerCase() + baseName.slice(1);
        const altFileName = lowerName + ext;
        const altPath = dirPath ? `${dirPath}/${altFileName}` : altFileName;
        if (altPath !== filePath) {
          fallbacks.push(altPath);
        }
      }
      // 先頭が小文字の場合は大文字版を追加
      else if (baseName.charAt(0).toLowerCase() === baseName.charAt(0)) {
        const upperName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
        const altFileName = upperName + ext;
        const altPath = dirPath ? `${dirPath}/${altFileName}` : altFileName;
        if (altPath !== filePath) {
          fallbacks.push(altPath);
        }
      }
    }
  }
  
  return fallbacks;
}

// ★新機能：@repo owner/repo コマンドを解析してリポジトリを取得★
function parseRepoCommand(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  const repoPattern = /@repo\s+([^\s\n]+)/gi;
  const match = repoPattern.exec(text);
  if (match) {
    return match[1].trim();
  }
  return null;
}

// GitHubからコードを取得（@code / @c コマンド対応・複数対応・一覧取得モード対応・別名フォールバック対応・ディレクトリ自動判別対応）★
function fetchGithubCodeByCommand(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  
  // Script Properties から GitHub設定を取得
  const props = PropertiesService.getScriptProperties();
  const githubToken = props.getProperty('GITHUB_TOKEN');
  let githubRepo = props.getProperty('GITHUB_REPO');
  
  // ★新機能：@repo owner/repo コマンドがあれば優先的に使用★
  const repoFromCommand = parseRepoCommand(text);
  if (repoFromCommand) {
    githubRepo = repoFromCommand;
  }
  
  if (!githubToken || !githubRepo) {
    // 未設定時は1件だけエラーを返す（複数件あっても最初の1件のみ）
    // ★修正：System:を付けない（runRelay()側で【System】を付与）★
    return [{ success: false, error: "GitHub Token/Repo not set." }];
  }
  
  // ★新機能：@code または @c のパターンを検出（複数行に対応・owner/repo:path 形式にも対応）★
  // @code owner/repo:path または @code path の形式を検出
  const codePattern = /@(?:code|c)\s+([^\s\n]+)/gi;
  const matches = [];
  let match;
  while ((match = codePattern.exec(text)) !== null) {
    const filePath = match[1].trim();
    if (filePath) {
      matches.push(filePath);
    }
  }
  
  if (matches.length === 0) {
    return [];
  }
  
  const MAX_FILE_SIZE = 50000; // 50KB（約5万文字）を上限とする
  const MAX_LIST_ITEMS = 200; // 一覧表示の上限（200件）
  const results = [];
  
  // 各ファイルを取得
  matches.forEach(filePath => {
    try {
      // ★新機能：owner/repo:path 形式の解析★
      let currentRepo = githubRepo;
      let targetPath = filePath;
      
      // owner/repo:path 形式をチェック
      const repoPathMatch = filePath.match(/^([^\/]+)\/([^:]+):(.+)$/);
      if (repoPathMatch) {
        currentRepo = `${repoPathMatch[1]}/${repoPathMatch[2]}`;
        targetPath = repoPathMatch[3];
      }
      
      // ★新機能：@code list <path> 形式の判定★
      let isListCommand = false;
      if (targetPath.startsWith('list ')) {
        isListCommand = true;
        targetPath = targetPath.substring(5).trim(); // 'list ' を削除
        if (!targetPath || targetPath === '') {
          targetPath = ''; // list のみの場合はroot
        }
      } else if (targetPath === 'list' || targetPath === 'ls' || targetPath === '.' || targetPath === '/' || targetPath === '//') {
        isListCommand = true;
        targetPath = '';
      }
      
      // パスを / 区切りで分割し、各セグメントをURLエンコード（日本語や記号対策）
      const pathSegments = targetPath === '' ? [] : targetPath.split('/').filter(s => s).map(segment => encodeURIComponent(segment));
      const encodedPath = pathSegments.join('/');
      
      // ★新機能：GitHub Contents API を常にJSON形式で取得して、配列かファイルかを自動判別★
      const apiUrl = `https://api.github.com/repos/${currentRepo}/contents/${encodedPath}`;
      
      const options = {
        method: 'get',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github+json', // ★修正：常にJSON形式で取得★
          'User-Agent': 'AI-Strategy-Room'
        },
        muteHttpExceptions: true
      };
      
      const response = UrlFetchApp.fetch(apiUrl, options);
      const statusCode = response.getResponseCode();
      
      if (statusCode === 200) {
        const jsonText = response.getContentText();
        let apiResponse;
        try {
          apiResponse = JSON.parse(jsonText);
        } catch (parseError) {
          results.push({ success: false, error: `GitHub Fetch Error: Failed to parse JSON - ${filePath}` });
          return;
        }
        
        // ★新機能：配列ならディレクトリ、オブジェクト（type: "file"）ならファイルとして処理★
        if (Array.isArray(apiResponse) || (apiResponse.type && apiResponse.type === 'dir')) {
          // ディレクトリ一覧を取得
          const dirItems = Array.isArray(apiResponse) ? apiResponse : [apiResponse];
          
          // ファイル名のリストを作成（上限200件、file/dirを区別）
          const fileNames = [];
          const dirNames = [];
          const totalItems = dirItems.length;
          let shownCount = 0;
          
          for (let i = 0; i < dirItems.length && shownCount < MAX_LIST_ITEMS; i++) {
            const item = dirItems[i];
            if (item && item.name) {
              if (item.type === 'dir') {
                dirNames.push(item.name);
              } else if (item.type === 'file') {
                fileNames.push(item.name);
              }
              shownCount++;
            }
          }
          
          // 一覧テキストを生成（ディレクトリを先に、その後ファイル）
          const displayPath = targetPath === '' ? 'root' : targetPath;
          let listText = `GitHub LIST (${displayPath}): ${totalItems} items\n\n`;
          
          // ディレクトリを先に表示
          dirNames.forEach(name => {
            listText += `- dir: ${name}/\n`;
          });
          
          // ファイルを表示
          fileNames.forEach(name => {
            listText += `- file: ${name}\n`;
          });
          
          if (totalItems > MAX_LIST_ITEMS) {
            listText += `\n...and ${totalItems - MAX_LIST_ITEMS} more`;
          }
          
          // コードフェンス付きで返す（text形式）
          const codeBlock = `\`\`\`text\n${listText}\`\`\``;
          
          results.push({ 
            success: true, 
            code: codeBlock, 
            error: null,
            path: filePath,
            actualPath: filePath,
            length: listText.length,
            sha256: '',
            truncated: false,
            shownLen: listText.length,
            isList: true,
            itemCount: totalItems
          });
        } else if (apiResponse.type && apiResponse.type === 'file') {
          // ★新機能：ファイルの場合、download_url または raw content を取得★
          let rawContent;
          let fileName = apiResponse.name || (pathSegments.length > 0 ? decodeURIComponent(pathSegments[pathSegments.length - 1]) : '');
          
          // download_url があればそれを使用、なければ content (base64) をデコード
          if (apiResponse.download_url) {
            try {
              const fileResponse = UrlFetchApp.fetch(apiResponse.download_url, {
                method: 'get',
                headers: {
                  'Authorization': `Bearer ${githubToken}`,
                  'User-Agent': 'AI-Strategy-Room'
                },
                muteHttpExceptions: true
              });
              
              if (fileResponse.getResponseCode() === 200) {
                rawContent = fileResponse.getContentText();
              } else {
                // download_url が失敗した場合は content (base64) を使用
                if (apiResponse.content) {
                  rawContent = Utilities.newBlob(Utilities.base64Decode(apiResponse.content.replace(/\s/g, ''))).getDataAsString();
                } else {
                  results.push({ success: false, error: `GitHub Fetch Error: Unable to fetch file content - ${filePath}` });
                  return;
                }
              }
            } catch (fetchError) {
              // download_url が失敗した場合は content (base64) を使用
              if (apiResponse.content) {
                rawContent = Utilities.newBlob(Utilities.base64Decode(apiResponse.content.replace(/\s/g, ''))).getDataAsString();
              } else {
                results.push({ success: false, error: `GitHub Fetch Error: ${String(fetchError)} - ${filePath}` });
                return;
              }
            }
          } else if (apiResponse.content) {
            // base64エンコードされた content をデコード
            rawContent = Utilities.newBlob(Utilities.base64Decode(apiResponse.content.replace(/\s/g, ''))).getDataAsString();
          } else {
            results.push({ success: false, error: `GitHub Fetch Error: No content available - ${filePath}` });
            return;
          }
          
          const originalLength = rawContent.length;
          
          // SHA256ハッシュを計算（切り捨て前のrawContentで計算）
          const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawContent, Utilities.Charset.UTF_8);
          const sha256 = hashBytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
          
          // 表示用contentを準備（巨大ファイルの場合は途中で切る）
          let content = rawContent;
          let truncated = false;
          let shownLen = originalLength;
          if (content.length > MAX_FILE_SIZE) {
            content = content.substring(0, MAX_FILE_SIZE) + '\n\n... (ファイルが大きすぎるため、先頭' + MAX_FILE_SIZE + '文字のみ表示)';
            truncated = true;
            shownLen = MAX_FILE_SIZE;
          }
          
          // コードフェンス付きで返す
          const codeBlock = `\`\`\`${getFileExtension(fileName)}\n${content}\n\`\`\``;
          
          results.push({ 
            success: true, 
            code: codeBlock, 
            error: null,
            path: filePath,
            actualPath: filePath,
            length: originalLength,
            sha256: sha256,
            truncated: truncated,
            shownLen: shownLen
          });
        } else {
          results.push({ success: false, error: `GitHub Fetch Error: Unknown response type - ${filePath}` });
          return;
        }
      } else if (statusCode === 404) {
        // ★修正：404エラー時のみ、別名フォールバックを試す（ファイルの場合のみ、list コマンドでない場合）★
        if (!isListCommand) {
          // ★修正：targetPath（元のパス）から別名候補を生成★
          const fallbackPaths = generateFallbackPaths(targetPath);
          let found = false;
          
          // ★修正：別名候補を順に試す（404エラーの場合のみ）★
          for (let i = 0; i < fallbackPaths.length && !found; i++) {
            const fallbackPath = fallbackPaths[i];
            // ★修正：パスを正しく分割してURLエンコード（パス付きファイルにも対応）★
            const fallbackSegments = fallbackPath.split('/').filter(s => s).map(segment => encodeURIComponent(segment));
            const fallbackEncodedPath = fallbackSegments.join('/');
            
            try {
              // ★修正：currentRepo を使用（owner/repo:path 形式に対応）★
              const fallbackApiUrl = `https://api.github.com/repos/${currentRepo}/contents/${fallbackEncodedPath}`;
              const fallbackOptions = {
                method: 'get',
                headers: {
                  'Authorization': `Bearer ${githubToken}`,
                  'Accept': 'application/vnd.github+json', // ★修正：JSON形式で取得して自動判別★
                  'User-Agent': 'AI-Strategy-Room'
                },
                muteHttpExceptions: true
              };
              
              const fallbackResponse = UrlFetchApp.fetch(fallbackApiUrl, fallbackOptions);
              const fallbackStatusCode = fallbackResponse.getResponseCode();
              
              // ★修正：200 OKの場合のみ成功とみなす（404の場合は次の候補を試す）★
              if (fallbackStatusCode === 200) {
                // 別名で取得成功（JSON形式で取得）
                const fallbackJsonText = fallbackResponse.getContentText();
                let fallbackApiResponse;
                try {
                  fallbackApiResponse = JSON.parse(fallbackJsonText);
                } catch (parseError) {
                  continue; // JSON解析失敗時は次の候補を試す
                }
                
                // ファイルのみを処理（ディレクトリの場合はスキップ）
                if (fallbackApiResponse.type && fallbackApiResponse.type === 'file') {
                  let rawContent;
                  const fileName = fallbackSegments.length > 0 ? decodeURIComponent(fallbackSegments[fallbackSegments.length - 1]) : '';
                  
                  // download_url があればそれを使用、なければ content (base64) をデコード
                  if (fallbackApiResponse.download_url) {
                    try {
                      const fileResponse = UrlFetchApp.fetch(fallbackApiResponse.download_url, {
                        method: 'get',
                        headers: {
                          'Authorization': `Bearer ${githubToken}`,
                          'User-Agent': 'AI-Strategy-Room'
                        },
                        muteHttpExceptions: true
                      });
                      
                      if (fileResponse.getResponseCode() === 200) {
                        rawContent = fileResponse.getContentText();
                      } else if (fallbackApiResponse.content) {
                        rawContent = Utilities.newBlob(Utilities.base64Decode(fallbackApiResponse.content.replace(/\s/g, ''))).getDataAsString();
                      } else {
                        continue;
                      }
                    } catch (fetchError) {
                      if (fallbackApiResponse.content) {
                        rawContent = Utilities.newBlob(Utilities.base64Decode(fallbackApiResponse.content.replace(/\s/g, ''))).getDataAsString();
                      } else {
                        continue;
                      }
                    }
                  } else if (fallbackApiResponse.content) {
                    rawContent = Utilities.newBlob(Utilities.base64Decode(fallbackApiResponse.content.replace(/\s/g, ''))).getDataAsString();
                  } else {
                    continue;
                  }
                  
                  const originalLength = rawContent.length;
                  
                  // SHA256ハッシュを計算
                  const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawContent, Utilities.Charset.UTF_8);
                  const sha256 = hashBytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
                  
                  // 表示用contentを準備
                  let content = rawContent;
                  let truncated = false;
                  let shownLen = originalLength;
                  if (content.length > MAX_FILE_SIZE) {
                    content = content.substring(0, MAX_FILE_SIZE) + '\n\n... (ファイルが大きすぎるため、先頭' + MAX_FILE_SIZE + '文字のみ表示)';
                    truncated = true;
                    shownLen = MAX_FILE_SIZE;
                  }
                  
                  // コードフェンス付きで返す
                  const codeBlock = `\`\`\`${getFileExtension(fileName)}\n${content}\n\`\`\``;
                  
                  // ★修正：actualPathに実際に取得できたpath（別名）を設定★
                  results.push({ 
                    success: true, 
                    code: codeBlock, 
                    error: null,
                    path: filePath, // 要求されたpath
                    actualPath: fallbackPath, // 実際に取得できたpath（別名）
                    length: originalLength,
                    sha256: sha256,
                    truncated: truncated,
                    shownLen: shownLen
                  });
                  
                  found = true;
                  break; // ★修正：returnではなくbreak（forEach内のreturnは動作しない）★
                }
              }
              // ★修正：404以外のエラー（401, 403等）の場合は別名フォールバックを試さない★
              else if (fallbackStatusCode !== 404) {
                // 認証エラー等の場合は別名フォールバックを試さない
                break;
              }
            } catch (fallbackError) {
              // 別名でも失敗した場合は次の候補を試す
              continue;
            }
          }
          
          // 全ての別名候補でも失敗した場合
          if (!found) {
            let errorMessage = `GitHub Fetch Error (404): File not found - ${filePath}`;
            if (fallbackPaths.length > 0) {
              errorMessage += ` (tried fallbacks: ${fallbackPaths.join(', ')})`;
            }
            results.push({ success: false, error: errorMessage });
          }
        } else {
          // list コマンドの場合は別名フォールバックを試さない
          let errorMessage = `GitHub Fetch Error (404): File or directory not found - ${filePath}`;
          
          // list コマンドで404の場合はrepo/権限の可能性を追加
          if (isListCommand || (targetPath === '')) {
            errorMessage += '. Check GITHUB_REPO or token scope for private repo.';
          }
          
          results.push({ success: false, error: errorMessage });
        }
      } else {
        const errorText = response.getContentText();
        // ★修正：System:を付けない（runRelay()側で【System】を付与）★
        results.push({ success: false, error: `GitHub Fetch Error (${statusCode}): ${errorText}` });
      }
    } catch (e) {
      // ★修正：System:を付けない（runRelay()側で【System】を付与）★
      results.push({ success: false, error: `GitHub Fetch Error: ${String(e && e.message ? e.message : e)}` });
    }
  });
  
  return results;
}

// ファイル拡張子から言語名を推測
function getFileExtension(fileName) {
  if (!fileName) return '';
  const ext = fileName.split('.').pop().toLowerCase();
  const extMap = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'rb': 'ruby',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'cs': 'csharp',
    'go': 'go',
    'rs': 'rust',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'ps1': 'powershell',
    'sql': 'sql',
    'r': 'r',
    'm': 'matlab',
    'gs': 'javascript', // Google Apps Script
    'tsx': 'typescript',
    'vue': 'vue',
    'svelte': 'svelte'
  };
  return extMap[ext] || ext;
}

// 画像サイズチェック
function validateImageSize(imagesBase64) {
  if (!imagesBase64 || imagesBase64.length === 0) return { ok: true, sizeMB: 0 };
  
  let totalSize = 0;
  for (let i = 0; i < imagesBase64.length; i++) {
    const s = String(imagesBase64[i]);
    // Base64のおおよそのサイズ計算 (文字数 * 0.75)
    totalSize += s.length * 0.75; 
  }

  const sizeMB = totalSize / (1024 * 1024);
  // 安全マージンをとってMAX_IMAGE_SIZE_MB(4MB)以下ならOK
  if (sizeMB > MAX_IMAGE_SIZE_MB) {
    return { ok: false, sizeMB: Math.round(sizeMB * 10) / 10 };
  }
  return { ok: true, sizeMB: sizeMB };
}

// 画像保存（閉じカッコ欠け修正 + mime判定安全化）
function saveImagesToDriveSafe(theme, imagesBase64) {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);

  const urls = [];
  (imagesBase64 || []).forEach((dataUrl, i) => {
    try {
      const s = String(dataUrl || "");
      const m = s.match(/^data:(.+?);base64,(.+)$/);
      const mime = m ? m[1] : "image/jpeg";
      const b64 = m ? m[2] : (s.split(',')[1] || "");
      if (!b64) throw new Error("Invalid image data");

      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
      const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
      const name = `img_${ts}_${i}.${ext}`;

      const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, name);
      const file = folder.createFile(blob);
      urls.push(file.getUrl());
    } catch (e) {}
  });

  return urls;
}
