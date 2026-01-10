本体は wit-ai-strategy-room。こちらは過去保管です

# ai-strategy-room
AI戦略会議室 / AI Team Strategy Room. ChatGPT (Yui), Gemini, and Rex (Cursor) をつないで、開発会議・指示書づくりを行う Google Apps Script アプリ。

## main → stable 合流手順（保管版更新ルール）

### ブランチの役割
- **main**：作業用ブランチ（GAS からの Push 先）
- **stable**：保管用ブランチ（誤操作防止のため保護済み）

stable は **直接編集・直接 Push しない** こと。

---

### main → stable 合流手順（保存版更新）

#### 1. Pull Request を作成
1. GitHub リポジトリを開く
2. 上部メニュー **Pull requests** → **New pull request**

#### 2. 向きを必ず確認
以下の向きで設定すること（逆にしない）：

- **base：stable**（合流先）
- **compare：main**（合流元）

※ 合言葉：  
👉「**stable に main を入れる**」

#### 3. 差分を確認
- 差分が表示され、`Able to merge` と出れば OK
- `There isn’t anything to compare` と出た場合  
  → main と stable が同一のため、更新不要

#### 4. 合流（マージ）
1. **Create pull request**
2. **Merge pull request**
3. **Confirm merge**

---

### 合流後の確認（30秒）
1. ブランチを **stable** に切り替える
2. `index.html` / `Code.gs` の更新時刻・コミット内容を確認  
→ 新しければ完了

---

### 禁止事項（事故防止）
- stable ブランチで直接編集しない
- stable に直接 Push しない
- base / compare を逆にしない

---

### stable を更新するタイミング
- 動作確認が取れたとき
- 「この版を基準にする」と決めたときのみ

※ 毎回更新する必要はない
