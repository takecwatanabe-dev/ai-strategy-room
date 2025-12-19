/**
 * APP: AI Strategy Room
 * FILE: Code.gs (Server-side)
 * VERSION: v0.2.8-conversation
 * BUILD: 2025-12-19_1043_conversation-persona
 * 
 * 【統合版】Gemini版の機能 + ユイUI統合 + 完全動作保証
 * 
 * 【修正情報】
 * 修正日時: 2025-12-19 10:43:00 JST
 * 修正AI: レックス (Rex)
 * AI種類: Claude (Cursor)
 * 修正内容: 
 * - マルチターン会話対応（会話履歴保持）
 * - ペルソナ実装（Yui/Rex/Geminiの個性注入）
 * - システムプロンプト追加（各API対応）
 * - 温度設定（0.3〜0.4で固定）
 */

// ▼▼ 設定エリア ▼▼
const APP_VERSION = 'v0.2.8-conversation';
const BUILD_ID = '2025-12-19_1043_conversation-persona';

// ペルソナ定義（システムプロンプト）
const PERSONA_YUI = `あなたはYui（ユイ）です。秘書・進行役として、ナベさんをサポートする役割です。

【性格・口調】
- 丁寧で親しみやすく、前向きな姿勢
- 「〜ですね」「承知しました」「いかがでしょうか」などの柔らかい敬語を使用
- 情報を整理し、次のアクションを提案する

【役割】
- 会議の進行をサポート
- 情報を整理して分かりやすく伝える
- 次のステップを提案する`;

const PERSONA_REX = `あなたはRex（レックス）です。レッドチーム（批判的思考）として、リスクや欠陥を指摘する役割です。

【性格・口調】
- 断定的・簡潔で、現実的で懐疑的
- 「〜だ」「俺はこう思う」「甘いな」などの断定的な口調
- 論点の欠陥やリスクを容赦なく指摘（ただし人格攻撃はNG）

【役割】
- 技術的な視点から提案
- リスクや欠陥を指摘
- 現実的な解決策を提示する`;

const PERSONA_GEMINI = `あなたはGemini（ジェミニ）です。分析官・参謀として、情報を整理し複数の観点から提案する役割です。

【性格・口調】
- 論理的、網羅的、冷静沈着
- 「分析します」「以下の3点が重要です」「メリット/デメリットを整理すると」などの標準的で知的なAI口調

【役割】
- 情報を構造化して整理
- 複数の観点から分析
- メリット・デメリットを整理して提案する`;

// APIキー取得
const PROPS = PropertiesService.getScriptProperties();
const OPENAI_API_KEY = PROPS.getProperty('OPENAI_API_KEY') || '';
const CLAUDE_API_KEY = PROPS.getProperty('CLAUDE_API_KEY') || '';
const GEMINI_API_KEY = PROPS.getProperty('GEMINI_API_KEY') || '';

// Geminiモデル定義（Script Propertiesから読み込み、既定値はgemini-2.5-flash）
// 注意: 値には models/ を付けない（例: gemini-2.5-flash）
// models/ が含まれている場合は自動除去
function getGeminiModel() {
  let model = PROPS.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  // models/ が含まれている場合は削除（重複防止）
  model = model.replace(/^models\//, '').trim();
  return model;
}
// ▲▲ 設定エリア ▲▲


/**
 * 1. 画面表示 (doGet)
 * ★重要：テンプレート変数を「両対応で全部」渡す（ReferenceError完全防止）
 */
function doGet() {
  const t = HtmlService.createTemplateFromFile('index');
  
  // 現在日時を取得
  const now = new Date();
  const nowStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const nowJstStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const dateJstStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  
  // テンプレート変数を「両対応で全部」設定（事故防止）
  // APP_VERSION / VERSION
  t.APP_VERSION = APP_VERSION;
  t.VERSION = APP_VERSION;
  
  // BUILD_ID / BUILD
  t.BUILD_ID = BUILD_ID;
  t.BUILD = BUILD_ID;
  
  // NOW / NOW_JST
  t.NOW = nowStr;
  t.NOW_JST = nowJstStr;
  
  // DATE / DATE_JST
  t.DATE = dateStr;
  t.DATE_JST = dateJstStr;

  return t.evaluate()
    .setTitle('AI Strategy Room')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/**
 * 2. 権限承認用ダミー関数 (initAuth)
 * エディタ上で一度「実行」して権限ポップアップを出してください
 * ★修正：必須ステップではなく、Best Effort（失敗しても処理継続）
 * ★重要：Drive権限トリガ（DriveApp.getStorageUsed）を確実に実行
 */
function initAuth() {
  Logger.log("権限チェック開始...");
  const result = { success: false, message: '', warnings: [] };
  
  try {
    SpreadsheetApp.getActiveSpreadsheet(); // スプシ権限
  } catch (e) {
    Logger.log('SpreadsheetApp.getActiveSpreadsheet() failed (expected if not bound to spreadsheet): ' + e.toString());
  }
  
  // Drive権限（Best Effort：失敗してもthrowしない）
  try {
    DriveApp.getStorageUsed();  // ストレージ使用量取得（権限要求）
    DriveApp.getRootFolder();   // ルートフォルダ取得（権限要求）
    const testFile = DriveApp.createFile('test_permission.txt', 'test', MimeType.PLAIN_TEXT);
    testFile.setTrashed(true);  // テストファイルを削除
    Logger.log("Drive権限チェック完了：OK");
    result.success = true;
    result.message = '権限承認が完了しました。';
  } catch (e) {
    Logger.log("Drive権限エラー: " + e.toString());
    result.success = false;
    result.message = 'Drive権限が承認されていません。保存できない場合も分析は続行します。';
    result.warnings.push('Drive権限: ' + e.message);
    // throwしない（必須ステップにしない）
  }
  
  Logger.log("権限チェック完了：" + (result.success ? "OK" : "警告あり（処理継続）"));
  return result;
}


/**
 * 3. 接続テスト (Ping)
 */
function testPing() {
  return { 
    success: true, 
    message: "Connection OK", 
    keys: {
      yui: !!OPENAI_API_KEY,
      rex: !!CLAUDE_API_KEY,
      gemini: !!GEMINI_API_KEY
    }
  };
}

/**
 * 3-2. Drive権限チェック（Web側から呼び出し可能）
 * 起動時に自動チェックして、未承認時は警告表示
 * ★修正：結果オブジェクト化（ok, message）
 */
function checkDriveAuth() {
  try {
    // Drive権限の確認（getRootFolder().getName()で実際にアクセスを試みる）
    const rootFolder = DriveApp.getRootFolder();
    const folderName = rootFolder.getName();
    Logger.log("Drive権限チェック: OK (ルートフォルダ名: " + folderName + ")");
    return { 
      ok: true,
      authorized: true,
      message: "Drive権限は承認済みです"
    };
  } catch (e) {
    Logger.log("Drive権限チェック: NG - " + e.toString());
    return { 
      ok: false,
      authorized: false,
      message: "Drive未承認です。GASでinitAuth()を実行→新しいデプロイ",
      error: e.toString()
    };
  }
}


/**
 * 4. メイン処理：会話リレー (runRelay)
 * Gemini版の機能（target選択）を統合
 * ★修正：複数画像対応（imagesArray: [{base64, mime}, ...]）
 * ★v0.2.8追加：会話履歴対応（historyPayload: {perAIHistory, roomSharedHistory}）
 */
function runRelay(userInput, imagesArray, target, historyPayload) {
  Logger.log('runRelay開始: ' + userInput + ' (target: ' + (target || 'all') + ', images: ' + (imagesArray ? imagesArray.length : 0) + '枚)');
  const warnings = [];
  const result = { yui: '', rex: '', gemini: '', logUrl: '' };
  const tg = (target || 'all').toLowerCase();
  
  try {
    // 複数画像がある場合、Driveに保存（try/catchで握る・失敗しても分析継続）
    const driveResult = saveImagesToDrive(imagesArray);
    const imageUrls = driveResult.urls || [];
    
    // Drive保存結果を警告に追加（短い日本語）
    if (driveResult.driveFailCount > 0) {
      const msg = `Drive保存：成功 ${driveResult.driveSavedCount} / ${imagesArray.length}（保存できない場合も分析は続行します）`;
      warnings.push(msg);
    }
    
    // 画像データはbase64のまま保持（Drive URLは補助情報として使用）
    // AI送信時はbase64を直接使用（Drive保存失敗時も分析可能）

    // --- Step 1: Yui ---
    if (tg === 'all' || tg === 'yui') {
      Logger.log('Yui呼び出し開始');
      if (OPENAI_API_KEY) {
        try { 
          // 画像がある場合はbase64をプロンプトに含める（Drive URLは補助情報）
          let prompt = userInput;
          if (imagesArray && imagesArray.length > 0) {
            const imageInfo = imagesArray.map((img, idx) => {
              const urlInfo = imageUrls[idx] ? `\n[画像${idx + 1} URL: ${imageUrls[idx]}]` : '';
              return `\n[画像${idx + 1}データ: base64形式で送信済み]${urlInfo}`;
            }).join('\n');
            prompt = userInput + '\n\n' + imageInfo;
          }
          result.yui = callOpenAI(prompt, imagesArray, historyPayload, 'yui');
          Logger.log('Yui呼び出し成功');
        } 
        catch (e) { 
          Logger.log('Yui呼び出しエラー: ' + e.toString());
          result.yui = `(Error) ${e.message}`; 
          warnings.push(`Yui: ${e.message}`); 
        }
      } else {
        Logger.log('Yui APIキー未設定、Mock応答');
        result.yui = `【Yui(Mock)】「${userInput}」について検討します。(Key未設定)`;
      }
    } else { 
      result.yui = `(スキップ)`; 
    }

    // --- Step 2: Rex ---
    if (tg === 'all' || tg === 'rex') {
      Logger.log('Rex呼び出し開始');
      // 会話履歴と共有ログを組み込んだプロンプト構築
      let rexPrompt = userInput;
      if (historyPayload && historyPayload.roomSharedHistory && historyPayload.roomSharedHistory.length > 0) {
        const sharedContext = historyPayload.roomSharedHistory.map((round, idx) => {
          return `[ラウンド${idx + 1}]\n${round}`;
        }).join('\n\n');
        rexPrompt = `【過去の会話】\n${sharedContext}\n\n【今回のテーマ】\n${userInput}`;
      }
      // 今回のYuiの発言があれば追加
      if (result.yui && result.yui !== '(スキップ)') {
        rexPrompt += `\n\n【Yuiの意見】\n${result.yui}`;
      }
      
      if (CLAUDE_API_KEY) {
        try { 
          result.rex = callClaudeAPI(rexPrompt, historyPayload, 'rex');
          Logger.log('Rex呼び出し成功');
        } 
        catch (e) { 
          Logger.log('Rex呼び出しエラー: ' + e.toString());
          result.rex = `(Error) ${e.message}`; 
          warnings.push(`Rex: ${e.message}`); 
        }
            } else {
        Logger.log('Rex APIキー未設定、Mock応答');
        result.rex = `【Rex(Mock)】GASでの実装を提案します。(Key未設定)`;
      }
            } else {
      result.rex = `(スキップ)`; 
    }

    // --- Step 3: Gemini ---
    if (tg === 'all' || tg === 'gemini') {
      Logger.log('Gemini呼び出し開始');
      // 会話履歴と共有ログを組み込んだプロンプト構築
      let geminiPrompt = userInput;
      if (historyPayload && historyPayload.roomSharedHistory && historyPayload.roomSharedHistory.length > 0) {
        const sharedContext = historyPayload.roomSharedHistory.map((round, idx) => {
          return `[ラウンド${idx + 1}]\n${round}`;
        }).join('\n\n');
        geminiPrompt = `【過去の会話】\n${sharedContext}\n\n【今回のテーマ】\n${userInput}`;
      }
      // 今回のYuiとRexの発言があれば追加
      if (result.yui && result.yui !== '(スキップ)') {
        geminiPrompt += `\n\n【Yuiの意見】\n${result.yui}`;
      }
      if (result.rex && result.rex !== '(スキップ)') {
        geminiPrompt += `\n\n【Rexの意見】\n${result.rex}`;
      }
      
      if (GEMINI_API_KEY) {
        try { 
          result.gemini = callGeminiAPI(geminiPrompt, historyPayload, 'gemini');
          Logger.log('Gemini呼び出し成功');
        } 
        catch (e) { 
          Logger.log('Gemini呼び出しエラー: ' + e.toString());
          // ユーザー向け短文エラー（技術メッセージを出さない）
          const errorMsg = e.message.includes('混雑') ? e.message : 'Gemini APIエラーが発生しました。しばらく待ってから再試行してください。';
          result.gemini = `(エラー) ${errorMsg}`; 
          warnings.push(`Gemini: ${errorMsg}`); 
        }
            } else {
        Logger.log('Gemini APIキー未設定、Mock応答');
        result.gemini = `【Gemini(Mock)】了解しました。(Key未設定)`;
      }
    } else { 
      result.gemini = `(スキップ)`; 
    }

    Logger.log('runRelay完了');
    return { success: true, data: result, warnings: warnings };

  } catch (e) {
    Logger.log('runRelay全体エラー: ' + e.toString());
    return { success: false, error: e.toString(), stack: e.stack };
  }
}

// --- 画像保存ヘルパー（複数対応・失敗しても続行） ---
function saveImagesToDrive(imagesArray) {
  const result = {
    urls: [],
    driveSavedCount: 0,
    driveFailCount: 0,
    driveFailReasonShort: ''
  };
  
  if (!imagesArray || !Array.isArray(imagesArray) || imagesArray.length === 0) {
    return result;
  }
  
  Logger.log('画像保存開始: ' + imagesArray.length + '枚');
  
  imagesArray.forEach((img, index) => {
    try {
      if (img.base64 && img.mime) {
        const url = saveImageToDrive(img.base64, img.mime);
        result.urls.push(url);
        result.driveSavedCount++;
        Logger.log('画像保存完了[' + (index + 1) + ']: ' + url);
      }
    } catch (e) {
      Logger.log('画像保存エラー[' + (index + 1) + ']: ' + e.toString());
      result.driveFailCount++;
      // 最初のエラーのみ記録（短く）
      if (!result.driveFailReasonShort) {
        result.driveFailReasonShort = e.message || 'Drive保存失敗';
      }
    }
  });
  
  Logger.log('画像保存完了: 成功' + result.driveSavedCount + '枚、失敗' + result.driveFailCount + '枚');
  return result;
}

// 単一画像保存（内部関数）
function saveImageToDrive(base64Data, mimeType) {
  // Drive権限確認（確実に権限を要求）
  DriveApp.getStorageUsed();
  
  const data = base64Data.split(',')[1]; // ヘッダー除去
  const blob = Utilities.newBlob(Utilities.base64Decode(data), mimeType, "screenshot_" + Date.now() + ".png");
  const file = DriveApp.createFile(blob); // ルートに保存
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); // 閲覧可にする
  Logger.log('画像保存成功: ' + file.getUrl());
  return file.getUrl();
}

// --- API Calls ---
// ★v0.2.8修正：画像対応 + 会話履歴 + ペルソナ（システムプロンプト）
function callOpenAI(prompt, imagesArray, historyPayload, aiName) {
  const messages = [];
  
  // システムプロンプト（ペルソナ）を先頭に追加
  if (aiName === 'yui') {
    messages.push({ role: "system", content: PERSONA_YUI });
  }
  
  // 会話履歴を追加（perAIHistoryから）
  if (historyPayload && historyPayload.perAIHistory && historyPayload.perAIHistory[aiName]) {
    const history = historyPayload.perAIHistory[aiName];
    history.forEach((item) => {
      if (item.role && item.content) {
        messages.push({ role: item.role, content: item.content });
      }
    });
  }
  
  // 現在のユーザーメッセージ
  const userMessage = { role: "user", content: [] };
  userMessage.content.push({ type: "text", text: prompt });
  
  // 画像がある場合はbase64を追加（OpenAIのマルチモーダル形式）
  if (imagesArray && Array.isArray(imagesArray) && imagesArray.length > 0) {
    imagesArray.forEach((img) => {
      if (img.base64) {
        // data:image/png;base64, の形式から base64部分だけを取得
        const base64Data = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64;
        const mimeType = img.mime || 'image/png';
        userMessage.content.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64Data}`
          }
        });
      }
    });
  }
  messages.push(userMessage);
  
  const url = 'https://api.openai.com/v1/chat/completions';
  const options = {
    method: 'post',
    headers: { Authorization: 'Bearer ' + OPENAI_API_KEY },
    contentType: 'application/json',
    payload: JSON.stringify({
      model: "gpt-4o-mini",
      messages: messages,
      temperature: 0.3
    }),
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    throw new Error(response.getContentText());
  }
  return JSON.parse(response.getContentText()).choices[0].message.content;
}
// ★v0.2.8修正：会話履歴 + ペルソナ（システムプロンプト）
function callClaudeAPI(prompt, historyPayload, aiName) {
  const messages = [];
  
  // 会話履歴を追加（perAIHistoryから）
  if (historyPayload && historyPayload.perAIHistory && historyPayload.perAIHistory[aiName]) {
    const history = historyPayload.perAIHistory[aiName];
    history.forEach((item) => {
      if (item.role && item.content) {
        messages.push({ role: item.role, content: item.content });
      }
    });
  }
  
  // 現在のユーザーメッセージ
  messages.push({ role: 'user', content: prompt });
  
  // システムプロンプト（ペルソナ）
  let systemPrompt = '';
  if (aiName === 'rex') {
    systemPrompt = PERSONA_REX;
  }
  
  const url = 'https://api.anthropic.com/v1/messages';
  const options = {
    method: 'post',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    contentType: 'application/json',
    payload: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      temperature: 0.4,
      system: systemPrompt,
      messages: messages
    }),
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    throw new Error(response.getContentText());
  }
  return JSON.parse(response.getContentText()).content[0].text;
}

// ★Gemini API (503自動リトライ対応 + v0.2.8: 会話履歴 + ペルソナ)
// Script Propertiesからモデル名を取得し、models/ の混入を自動除去
// 503/UNAVAILABLE エラー時は最大3回リトライ（1s→3s→5s）
function callGeminiAPI(prompt, historyPayload, aiName) {
  const modelName = getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
  
  const maxRetries = 3;
  const delays = [1000, 3000, 5000]; // 1秒、3秒、5秒
  
  // システムプロンプト（ペルソナ）
  let systemInstruction = '';
  if (aiName === 'gemini') {
    systemInstruction = PERSONA_GEMINI;
  }
  
  // 会話履歴を構築
  const contents = [];
  if (historyPayload && historyPayload.perAIHistory && historyPayload.perAIHistory[aiName]) {
    const history = historyPayload.perAIHistory[aiName];
    history.forEach((item) => {
      if (item.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: item.content }] });
      } else if (item.role === 'assistant' || item.role === 'model') {
        contents.push({ role: 'model', parts: [{ text: item.content }] });
      }
    });
  }
  
  // 現在のユーザーメッセージ
  contents.push({ role: 'user', parts: [{ text: prompt }] });
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const payload = {
        contents: contents,
        generationConfig: {
          temperature: 0.3
        }
      };
      
      // システムプロンプトがある場合は追加
      if (systemInstruction) {
        payload.systemInstruction = {
          parts: [{ text: systemInstruction }]
        };
      }
      
      const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
      
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      
      // 成功時
      if (responseCode === 200) {
        const json = JSON.parse(responseText);
        return json.candidates[0].content.parts[0].text;
      }
      
      // 503またはUNAVAILABLEの場合のみリトライ
      if (responseCode === 503 || responseText.includes('UNAVAILABLE')) {
        if (attempt < maxRetries - 1) {
          const delay = delays[attempt];
          Logger.log(`Gemini 503/UNAVAILABLE (試行 ${attempt + 1}/${maxRetries})。${delay}ms待機してリトライ...`);
          Utilities.sleep(delay);
          continue; // リトライ
        } else {
          // 3回失敗
          throw new Error('混雑しています。1分ほど待って再試行してください。');
        }
      }
      
      // その他のエラーは即座にthrow
      throw new Error(responseText);
      
    } catch (e) {
      // リトライ可能なエラーでない場合、または最後の試行の場合はthrow
      if (attempt === maxRetries - 1 || (!e.message.includes('503') && !e.message.includes('UNAVAILABLE'))) {
        throw e;
      }
      // リトライ可能なエラーの場合、次のループへ
      const delay = delays[attempt];
      Logger.log(`Gemini エラー (試行 ${attempt + 1}/${maxRetries})。${delay}ms待機してリトライ...`);
      Utilities.sleep(delay);
    }
  }
  
  // ここには到達しないはずだが、念のため
  throw new Error('混雑しています。1分ほど待って再試行してください。');
}

// ★緊急用：使えるモデル一覧をログに出す関数
function debugListModels() {
  if (!GEMINI_API_KEY) {
    Logger.log("GEMINI_API_KEYが設定されていません");
    return;
  }
  const u = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;
  const r = UrlFetchApp.fetch(u, {muteHttpExceptions:true});
  Logger.log("=== 利用可能なモデル一覧 ===");
  Logger.log(r.getContentText());
}
