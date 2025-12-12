// APP: AI戦略会議室
// FILE: Code.gs
// VERSION: v16-api1
// BUILD: 2025-12-12_xxxx_ai-strategy-room-api
// AUTHOR: Gemini + Yui + Rex
//
// CHANGES:
// - UIカラーの統一（Yui=ピンク / Gemini=ブルー / Rex=グリーン）
// - GitHub + OpenAI API を使ったコードレビュー機能追加
// - 過去ログの自動マイグレーション機能（旧シートから新シートへコピー）
// - フッターにBuild IDを表示（デプロイミス確認用）
// - AI間転送ボタンのスタイル調整
//
// DEPLOY:
// 1. SPREADSHEET_ID を記入。
// 2. Script Properties に OPENAI_API_KEY と GITHUB_TOKEN を設定。
// 3. GITHUB_OWNER と GITHUB_REPO を設定（必要に応じて）。
// 4. 「デプロイを管理」→「鉛筆アイコン」→バージョン「新しいバージョン」を選択してデプロイ。

// スプレッドシートID（固定）
// URL: https://docs.google.com/spreadsheets/d/1zLQIsuMnbffaWM5D-kcDVPtAtyZfBfhkz7bPh6hlLDE/edit
const SPREADSHEET_ID = "1zLQIsuMnbffaWM5D-kcDVPtAtyZfBfhkz7bPh6hlLDE";

// ログ保存用の固定シート名
const LOG_SHEET_NAME = "AI_Strategy_Log";

// ===== GitHub & OpenAI 設定 =====

// GitHub リポジトリ情報（★あとで書き換え可）
const GITHUB_OWNER = 'YOUR_GITHUB_OWNER';      // 例: 'watanabe-nabe'
const GITHUB_REPO  = 'ai-strategy-room';       // 例: 'ai-strategy-room'
const GITHUB_PATH  = 'Code.gs';                // レビュー対象ファイル
const GITHUB_REF   = 'main';                   // ブランチ名

// プロパティ名（Script Properties）
const PROP_OPENAI_API_KEY = 'OPENAI_API_KEY';  // OpenAI API key を保存
const PROP_GITHUB_TOKEN   = 'GITHUB_TOKEN';    // GitHub Personal Access Token を保存

function doGet() {
  return HtmlService.createHtmlOutput(htmlContent)
    .setTitle("AI Team Strategy Room (v16-api1)")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// --- サーバー側機能 ---

// シート取得＆自動移行ヘルパー
function getLogSheet() {
  let ss;
  try {
    if (SPREADSHEET_ID && SPREADSHEET_ID.length > 20 && SPREADSHEET_ID !== "★ここにIDを貼り付けてください★") {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    } else {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }
  } catch (e) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }

  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  
  // 新シートがない場合（＝デプロイ直後）、旧シートからの移行を試みる
  if (!sheet) {
    const allSheets = ss.getSheets();
    const oldSheet = allSheets[0]; // たぶん一番左にあるのが旧ログ
    
    sheet = ss.insertSheet(LOG_SHEET_NAME);
    
    // 旧シートにデータがあればコピー（ヘッダーだけでなくデータがあるか確認）
    if (oldSheet.getLastRow() > 1) {
      const sourceRange = oldSheet.getDataRange();
      // 新シートのA1から貼り付け
      sourceRange.copyTo(sheet.getRange(1, 1));
    } else {
      // 旧データもなければヘッダーだけ作成
      sheet.appendRow(["Timestamp", "Speaker", "Content"]);
    }
  }
  return sheet;
}

function saveData(speaker, content, timestamp) {
  const sheet = getLogSheet();
  sheet.appendRow([timestamp, speaker, content]);
  return "Saved";
}

function loadHistory() {
  const sheet = getLogSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  return data.map(row => ({
    time: row[0],
    speaker: row[1],
    content: row[2]
  }));
}

function clearHistory() {
  const sheet = getLogSheet();
  sheet.clear();
  sheet.appendRow(["Timestamp", "Speaker", "Content"]);
  return "Cleared";
}

function deleteLog(timestamp, speaker, content) {
  const sheet = getLogSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "Not found";

  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    let rowTime = row[0];
    if (rowTime instanceof Date) {
        let h = rowTime.getHours().toString().padStart(2,'0');
        let m = rowTime.getMinutes().toString().padStart(2,'0');
        rowTime = h + ':' + m;
    }
    
    if (row[1] === speaker && row[2] === content) {
      sheet.deleteRow(i + 2);
      return "Deleted";
    }
  }
  return "Not found";
}

// ===== GitHub & OpenAI API 機能 =====

/**
 * Script Properties から値を取得するヘルパー
 */
function getScriptProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/**
 * GitHub から指定ファイルの中身（生テキスト）を取得
 * - contents API を raw で叩いてプレーンテキストをもらう
 */
function fetchGitHubFile(owner, repo, path, ref) {
  const token = getScriptProp(PROP_GITHUB_TOKEN);
  if (!token) {
    throw new Error('GITHUB_TOKEN が Script Properties に設定されていません。');
  }

  const url = 'https://api.github.com/repos/'
    + owner + '/' + repo + '/contents/' + encodeURIComponent(path)
    + '?ref=' + encodeURIComponent(ref || 'main');

  const options = {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github.v3.raw'
    },
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const code = res.getContentText();

  if (res.getResponseCode() >= 400 || !code) {
    throw new Error('GitHub からファイル取得に失敗しました: ' + res.getResponseCode() + ' ' + res.getContentText());
  }

  return code;
}

/**
 * OpenAI にコードレビューを依頼する
 * - codeText: GitHub から取ってきた Code.gs の中身
 * - contextText: どんなアプリかの説明（プロンプト用）
 * 
 * 戻り値: 日本語テキスト（説明＋改善ポイント）
 */
function callOpenAIForReview(codeText, contextText) {
  const apiKey = getScriptProp(PROP_OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が Script Properties に設定されていません。');
  }

  const url = 'https://api.openai.com/v1/chat/completions';
  const model = 'gpt-4o-mini'; // コスト重視で小さめモデルを指定（必要に応じて変更OK）

  const systemPrompt =
    'あなたは日本語で説明するシニアエンジニアです。' +
    'Google Apps Script と HTML/CSS/JavaScript のコードを読み、' +
    '・何をしているコードか（全体像）' +
    '・良い点' +
    '・バグや危険そうな箇所' +
    '・読みやすくするための改善案' +
    'を、なべちょうさん（プログラム初心者）向けに、' +
    '箇条書き中心でやさしく説明してください。';

  const userPrompt =
    '【アプリの説明】\\n' + contextText + '\\n\\n' +
    '【対象コード】\\n' +
    '```js\\n' + codeText.substring(0, 30000) + '\\n```\\n\\n' +
    '※長い場合は重要な部分を優先してレビューしてください。';

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const status = res.getResponseCode();
  const body = res.getContentText();

  if (status >= 400) {
    throw new Error('OpenAI API エラー: ' + status + ' ' + body);
  }

  const json = JSON.parse(body);
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) {
    throw new Error('OpenAI API のレスポンスから content を取得できませんでした。');
  }
  return content;
}

/**
 * AI戦略会議室 Code.gs を GitHub から取得し、
 * OpenAI にレビューさせた結果を
 * 「Yui カラムのログ」に [API-REVIEW] として追加する。
 *
 * 実行場所：
 *   Apps Script エディタ上で関数を選んで ▶ 実行
 *   （UIには新しいボタンは追加しなくてOK）
 */
function reviewStrategyRoomCode() {
  // 1) GitHub から Code.gs を取得
  const codeText = fetchGitHubFile(GITHUB_OWNER, GITHUB_REPO, GITHUB_PATH, GITHUB_REF);

  // 2) アプリの説明文（プロンプト用）
  const context =
    'これは「AI戦略会議室」という Web アプリの Code.gs です。' +
    'Commander / Yui / Gemini / Rex の 4つのカラムがあり、' +
    'スプレッドシートのログシート（AI_Strategy_Log）に会議内容を保存・表示します。' +
    'なべちょうさん・Yui・Gemini・Rex のやり取りを整理するために使います。';

  // 3) OpenAI にレビューを依頼
  const reviewText = callOpenAIForReview(codeText, context);

  // 4) Yui カラムのログとして保存
  const now = new Date();
  const timeStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    'HH:mm'
  );

  const content = '[API-REVIEW]\\n' + reviewText;
  saveData('Yui', content, timeStr);
}

// --- フロントエンド (HTML/CSS/JS) ---
const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <base target="_top">
    <meta charset="UTF-8">
    <style>
        /* v16: 基準フォントサイズ 24px */
        html { font-size: 24px; }
        body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 0; background-color: #2c3e50; height: 100vh; display: flex; flex-direction: column; color:#333; }
        
        /* ヘッダー */
        header { background-color: #1a252f; color: white; padding: 0.8rem 1rem; display: flex; flex-direction:column; gap:0.5rem; border-bottom: 0.2rem solid #34495e; }
        .header-top { display: flex; justify-content: space-between; align-items: center; width:100%; }
        h1 { margin: 0; font-size: 1.2rem; letter-spacing: 1px; }
        .ver-tag { font-size: 0.8rem; background: #e74c3c; padding: 2px 6px; border-radius: 4px; margin-left: 10px; }
        .header-controls { display: flex; align-items: center; gap: 0.5rem; }
        
        /* プロジェクト入力欄 */
        .project-bar { display:flex; gap:0.5rem; align-items:center; background:#34495e; padding:0.5rem; border-radius:0.3rem; }
        .project-label { font-size:0.8rem; color:#bdc3c7; font-weight:bold; }
        #project-name { background:transparent; border:none; color:white; font-weight:bold; font-size:1rem; flex:1; outline:none; }
        
        .btn-reset { background-color: #c0392b; color: white; border: none; padding: 0.4rem 0.8rem; border-radius: 0.3rem; cursor: pointer; font-size: 0.8rem; }
        .status-msg { font-size: 0.8rem; color: #f1c40f; margin-right: 0.5rem; }
        
        /* メインエリア */
        .board-container { display: flex; flex: 1; overflow: hidden; padding: 0.8rem; gap: 0.8rem; background-color: #ecf0f1; }
        .column { flex: 1; display: flex; flex-direction: column; border-radius: 0.4rem; background-color: white; box-shadow: 0 4px 8px rgba(0,0,0,0.15); overflow: hidden; }
        
        /* Team Colors */
        .col-cmd { border-top: 0.4rem solid #2c3e50; }  
        .col-yui { border-top: 0.4rem solid #ff6fa1; }   /* Yui → pink */
        .col-gem { border-top: 0.4rem solid #4285f4; }   /* Gemini → blue */
        .col-rex { border-top: 0.4rem solid #2ecc71; background-color:#fafafa; }  /* Rex → green */ 

        .col-header { padding: 0.6rem; font-weight: bold; text-align: center; border-bottom: 2px solid #eee; font-size:1rem; display:flex; justify-content:center; align-items:center; gap:0.3rem;}
        .role-badge { font-size:0.6rem; padding:0.2rem 0.4rem; border-radius:1rem; color:white; font-weight:normal; }
        
        .log-area { flex: 1; padding: 0.8rem; overflow-y: auto; background-color: #fff; font-size: 0.9rem; line-height: 1.6; }
        
        /* Message Bubbles */
        .message { margin-bottom: 0.8rem; padding: 0.6rem 0.8rem; border-radius: 0.4rem; white-space: pre-wrap; word-break: break-all; position:relative; }
        .message-header { display: flex; justify-content: space-between; margin-bottom: 0.2rem; font-size: 0.7rem; color: #7f8c8d; }
        .btn-delete { cursor: pointer; color: #e74c3c; margin-left: 0.5rem; font-weight: bold; }
        
        .col-cmd .message { background-color: #eaeff2; color: #2c3e50; }
        .col-yui .message { background-color: #ffe0eb; color: #8b2252; border-left: 0.3rem solid #ff6fa1;}
        .col-gem .message { background-color: #e8f0fe; color: #1a73e8; border-left: 0.3rem solid #4285f4;}
        .col-rex .message { background-color: #e8f5e9; color: #1b5e20; border-left: 0.3rem solid #2ecc71; font-family: monospace; font-size:0.85rem;}

        /* Input Area */
        .input-area { padding: 0.8rem; border-top: 2px solid #ddd; background-color: #fdfdfd; }
        textarea { width: 100%; height: 180px; box-sizing: border-box; margin-bottom: 0.5rem; padding: 0.5rem; border: 2px solid #bdc3c7; border-radius: 0.4rem; resize: none; font-family: inherit; font-size: 0.9rem; }
        
        /* Buttons */
        .btn-group { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
        button { flex: 1; padding: 0.8rem; cursor: pointer; border: none; border-radius: 0.4rem; font-weight: bold; color: white; font-size: 0.9rem; transition: opacity 0.2s; }
        button:hover { opacity: 0.8; }
        
        .btn-cmd { background-color: #2c3e50; }   /* Commander（変更なし） */
        .btn-yui { background-color: #ff6fa1; }   /* Yui メインボタン＆To Yui ボタン */
        .btn-gem { background-color: #4285f4; }   /* Gemini メインボタン＆To Gem ボタン */
        .btn-rex { background-color: #2ecc71; }   /* Rex メインボタン＆To Rex ボタン */
        
        /* AI間連携ボタン */
        .ai-link-group { display: flex; gap: 0.3rem; margin-bottom: 0.5rem; }
        .btn-ai-link { font-size: 0.8rem; padding: 0.5rem; opacity: 0.9; color: white; border: none; border-radius: 0.3rem; cursor: pointer; flex: 1; }
        
        .btn-ai-gem { background-color: #4285f4; }
        .btn-ai-rex { background-color: #2ecc71; }
        .btn-ai-yui { background-color: #ff6fa1; }
        .btn-ai-cmd { background-color: #95a5a6; } /* Copy to Cmd */

        .launch-group { display: flex; gap: 0.3rem; margin-top: 0.5rem; }
        .btn-launch { font-size: 0.8rem; padding: 0.6rem; opacity:0.9; }

        .options { font-size: 0.8rem; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem; color: #555; background: #fff3cd; padding: 0.3rem; border-radius: 0.3rem; }
        
        .rex-meta { display:flex; gap:0.5rem; margin-bottom:0.5rem; }
        .rex-meta input { flex:1; border:2px solid #ccc; padding:0.4rem; font-size:0.8rem; border-radius:0.3rem; }
        
        footer { text-align: center; font-size: 0.6rem; color: #7f8c8d; padding: 5px; background: #ecf0f1; }

    </style>
</head>
<body>

<header>
    <div class="header-top">
        <h1>Strategy Room <span class="ver-tag">v16-api1</span></h1>
        <div class="header-controls">
            <span id="status" class="status-msg"></span>
            <button class="btn-reset" onclick="clearAllData()">履歴全消去</button>
        </div>
    </div>
    <div class="project-bar">
        <span class="project-label">PROJECT:</span>
        <input type="text" id="project-name" placeholder="例: calc-train-v2" onchange="saveProjectName()">
    </div>
</header>

<div class="board-container">
    <div class="column col-cmd">
        <div class="col-header">👨‍✈️ Commander <span class="role-badge" style="background:#2c3e50;">LEADER</span></div>
        <div class="log-area" id="log-Commander"></div>
        <div class="input-area">
            <textarea id="in-Commander" placeholder="指示を入力..."></textarea>
            <div class="options">
                <input type="checkbox" id="include-history" checked>
                <label for="include-history">過去ログを含めてコピー</label>
            </div>
            <div class="btn-group">
                <button class="btn-cmd" onclick="handleSend('Commander', '[CMD]')">メモ保存</button>
            </div>
            <div style="text-align:center; font-size:0.7rem; color:#7f8c8d; margin-top:0.2rem;">↓ 保存してAIを起動 ↓</div>
            <div class="launch-group">
                <button class="btn-launch btn-yui" onclick="launchAI('chatgpt')">To Yui 🌸</button>
                <button class="btn-launch btn-gem" onclick="launchAI('gemini')">To Gemini ✨</button>
                <button class="btn-launch btn-rex" onclick="launchAI('cursor')">To Rex 🦖</button>
            </div>
        </div>
    </div>

    <div class="column col-yui">
        <div class="col-header">🌸 Yui <span class="role-badge" style="background:#ff6fa1;">PLANNER</span></div>
        <div class="log-area" id="log-Yui"></div>
        <div class="input-area">
            <div class="ai-link-group">
                <button class="btn-ai-link btn-ai-cmd" onclick="copyToCmd('Yui')">To Cmd</button>
                <button class="btn-ai-link btn-ai-gem" onclick="copyToAI('Yui', 'Gemini')">To Gem</button>
                <button class="btn-ai-link btn-ai-rex" onclick="copyToAI('Yui', 'Rex')">To Rex</button>
            </div>
            <textarea id="in-Yui" placeholder="Yuiの回答..."></textarea>
            <button class="btn-yui" onclick="handleSend('Yui', '[YUI]')">記録</button>
        </div>
    </div>

    <div class="column col-gem">
        <div class="col-header">✨ Gemini <span class="role-badge" style="background:#4285f4;">ADVISOR</span></div>
        <div class="log-area" id="log-Gemini"></div>
        <div class="input-area">
             <div class="ai-link-group">
                <button class="btn-ai-link btn-ai-cmd" onclick="copyToCmd('Gemini')">To Cmd</button>
                <button class="btn-ai-link btn-ai-yui" onclick="copyToAI('Gemini', 'Yui')">To Yui</button>
                <button class="btn-ai-link btn-ai-rex" onclick="copyToAI('Gemini', 'Rex')">To Rex</button>
            </div>
            <textarea id="in-Gemini" placeholder="Geminiの回答..."></textarea>
            <button class="btn-gem" onclick="handleSend('Gemini', '[GEM]')">記録</button>
        </div>
    </div>

    <div class="column col-rex">
        <div class="col-header">🦖 Rex <span class="role-badge" style="background:#2ecc71;">BUILDER</span></div>
        <div class="log-area" id="log-Rex"></div>
        <div class="input-area">
            <div class="ai-link-group">
                <button class="btn-ai-link btn-ai-cmd" onclick="copyToCmd('Rex')">To Cmd</button>
                <button class="btn-ai-link btn-ai-yui" onclick="copyToAI('Rex', 'Yui')">To Yui</button>
                <button class="btn-ai-link btn-ai-gem" onclick="copyToAI('Rex', 'Gemini')">To Gem</button>
            </div>
            <div class="rex-meta">
                <input type="text" id="rex-path" placeholder="Path">
                <input type="text" id="rex-ver" placeholder="Ver">
            </div>
            <textarea id="in-Rex" placeholder="Rexへの指示..."></textarea>
            <button class="btn-rex" onclick="handleRexSend()">記録</button>
        </div>
    </div>
</div>

<footer>
    Build: 2025-12-12_xxxx_ai-strategy-room-api (v16-api1) | Check your deployment if this ID is old.
</footer>

<script>
    window.onload = function() {
        showStatus("履歴読込中...");
        google.script.run.withSuccessHandler(renderHistory).loadHistory();
        const savedProj = localStorage.getItem('ai_team_project');
        if(savedProj) document.getElementById('project-name').value = savedProj;
    };

    let globalHistory = [];

    function saveProjectName() {
        const name = document.getElementById('project-name').value;
        localStorage.setItem('ai_team_project', name);
    }

    function renderHistory(data) {
        globalHistory = []; 
        ['Commander', 'Yui', 'Gemini', 'Rex'].forEach(id => {
            document.getElementById('log-' + id).innerHTML = '';
        });
        data.forEach(item => {
            let timeStr = item.time;
            if (typeof item.time !== 'string') {
                const d = new Date(item.time);
                timeStr = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
            }
            appendLogToScreen(item.speaker, item.content, timeStr);
            globalHistory.push({ time: timeStr, speaker: item.speaker, content: item.content });
        });
        showStatus("Ready (v16-api1)");
    }

    function appendLogToScreen(speaker, content, time) {
        let targetId = 'log-' + speaker;
        const logEl = document.getElementById(targetId);
        if(!logEl) return;
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message';
        let safeContent = content.replace(/</g, "&lt;").replace(/>/g, "&gt;"); 
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'message-header';
        
        const timeSpan = document.createElement('span');
        timeSpan.textContent = time;
        
        const delBtn = document.createElement('span');
        delBtn.className = 'btn-delete';
        delBtn.textContent = '🗑';
        delBtn.onclick = function() { deleteLogItem(time, speaker, content, msgDiv); };

        headerDiv.appendChild(timeSpan);
        headerDiv.appendChild(delBtn);

        const bodyDiv = document.createElement('div');
        bodyDiv.innerHTML = safeContent.replace(/\\n/g, '<br>');

        msgDiv.appendChild(headerDiv);
        msgDiv.appendChild(bodyDiv);
        
        logEl.appendChild(msgDiv);
        logEl.scrollTop = logEl.scrollHeight;
    }

    function handleSend(speaker, tag) {
        const inputId = 'in-' + speaker;
        const inputEl = document.getElementById(inputId);
        let text = inputEl.value;
        if (!text.trim()) return;

        if (!text.startsWith('[')) {
            text = tag + ' ' + text;
        }
        processAndSave(speaker, text);
        if (speaker !== 'Commander') inputEl.value = '';
    }

    function handleRexSend() {
        const inputEl = document.getElementById('in-Rex');
        const path = document.getElementById('rex-path').value;
        const ver = document.getElementById('rex-ver').value;
        let text = inputEl.value;
        
        if (!text.trim()) return;

        let header = '[REX]';
        if (path || ver) {
            header += '\\n【ファイル情報】';
            if(path) header += '\\n- Path: ' + path;
            if(ver) header += '\\n- Ver: ' + ver;
            header += '\\n----------------\\n';
        }
        
        if (!text.startsWith('[REX]')) {
            text = header + text;
        }
        processAndSave('Rex', text);
        inputEl.value = '';
    }

    function processAndSave(speaker, text) {
        const now = new Date();
        const timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
        
        appendLogToScreen(speaker, text, timeStr);
        globalHistory.push({ time: timeStr, speaker: speaker, content: text });
        
        showStatus("Saving...");
        google.script.run.withSuccessHandler(() => showStatus("Saved"))
            .saveData(speaker, text, timeStr);
    }
    
    function deleteLogItem(time, speaker, content, element) {
        if(!confirm("削除しますか？")) return;
        element.style.opacity = "0.5";
        google.script.run.withSuccessHandler((res) => {
            if(res === "Deleted") {
                element.remove();
                globalHistory = globalHistory.filter(i => !(i.time === time && i.speaker === speaker && i.content === content));
            } else {
                element.style.opacity = "1";
            }
        }).deleteLog(time, speaker, content);
    }

    // AI間連携コピー機能
    function copyToCmd(fromSpeaker) {
        const srcId = 'in-' + fromSpeaker;
        const text = document.getElementById(srcId).value;
        if(!text) return;
        document.getElementById('in-Commander').value = text; 
        showStatus("Copied to Cmd");
    }

    function copyToAI(fromSpeaker, toSpeaker) {
        const srcId = 'in-' + fromSpeaker;
        const text = document.getElementById(srcId).value;
        if(!text) return;
        
        let targetId = 'in-' + toSpeaker;
        // Rexの場合のみIDが変わる可能性はないが念のため
        if(toSpeaker === 'Rex') targetId = 'in-Rex';
        else if(toSpeaker === 'Gemini') targetId = 'in-Gemini';
        else if(toSpeaker === 'Yui') targetId = 'in-Yui';
        
        document.getElementById(targetId).value = text;
        showStatus("Copied to " + toSpeaker);
    }

    function clearAllData() {
        if(!confirm("全履歴を消去しますか？")) return;
        showStatus("Clearing...");
        google.script.run.withSuccessHandler(() => {
            renderHistory([]); 
            showStatus("Cleared");
        }).clearHistory();
    }

    function showStatus(msg) {
        const el = document.getElementById('status');
        el.textContent = msg;
        setTimeout(() => { if(el.textContent === msg) el.textContent = ''; }, 3000);
    }

    const URLS = { chatgpt: "https://chatgpt.com/", gemini: "https://gemini.google.com/app" };

    function launchAI(aiName) {
        const userInput = document.getElementById('in-Commander').value;
        const includeHistory = document.getElementById('include-history').checked;
        const projName = document.getElementById('project-name').value;

        if (!userInput.trim() && !includeHistory) {
            alert("指示を入力するか、履歴設定をONにしてください");
            return;
        }
        
        let tagName = "[To " + aiName.charAt(0).toUpperCase() + aiName.slice(1) + "]";
        if (aiName === 'cursor') tagName = "[To Rex]";
        
        if (userInput.trim()) {
            let textToSave = userInput;
            if (!textToSave.startsWith('[')) {
                textToSave = tagName + ' ' + textToSave;
            }
            processAndSave('Commander', textToSave);
        }

        let copyText = "";
        if (projName) copyText += "#PROJECT: " + projName + "\\n\\n";

        if (includeHistory && globalHistory.length > 0) {
            copyText += "--- TEAM LOG (Context) ---\\n";
            globalHistory.forEach(item => {
                copyText += \`[\${item.time}] \${item.speaker}:\\n\${item.content}\\n\\n\`;
            });
            copyText += "--- END LOG ---\\n\\n";
        }
        
        if (userInput.trim()) {
            copyText += "--- NEW ORDER ---\\n" + userInput;
        }

        navigator.clipboard.writeText(copyText).then(() => {
            if (aiName === 'cursor') {
                showStatus("Copied for Rex!");
                alert("Rex(Cursor)用にコピーしました。");
            } else {
                showStatus("Opening " + aiName + "...");
                window.open(URLS[aiName], '_blank');
            }
        });
    }
</script>
</body>
</html>
`;

