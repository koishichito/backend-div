# フロントエンド変更解説 — 元コードとの差分と理由

このドキュメントは、最初に用意した `app.js` / `index.html` / `style.css` を
**このバックエンド(FastAPI + Keycloak)で実際に動くように**修正した際の
変更点と、その理由をまとめたものです。

前提として押さえておくバックエンドの仕様（差分の理由はほぼここに集約されます）:

| 項目 | 仕様 |
|------|------|
| クイズの作成者フィールド | `owner`(コメントは `author`) |
| `answer_index` | **0 始まり**かつ `choices` の件数未満 |
| `category` | **必須**。許可値は `sns/internet/ai/java/python/html` のみ |
| 認証 | Keycloak の JWT。保護APIには `Authorization: Bearer <token>` が必須 |
| ログイン | 自前EPなし。**ブラウザから Keycloak のトークンEP（password grant）**で取得 |
| クイズ詳細 | `GET /quizzes/{id}` が**コメント込み**で返る。画像/本文フィールドは無い |
| 削除 | `DELETE /quizzes/{id}`（認証・**所有者のみ**） |

---

## 1. JavaScript（app.js）

### 1-1. `fetchQuiz` が二重定義 → 個別取得とコメント取得を分離

**元コード**（同名関数が2つ。後の定義が前を上書きし、個別クイズ取得が消える）

```js
async function fetchQuiz(quizId){            // ① 個別クイズ
  const response = await fetch(`...proxy/8099/quizzes${quizId}`)
  return await response.json()
}
async function fetchQuiz(quizId){            // ② コメント（①を上書き！）
  const response = await fetch(`...proxy/8099/quizzes${quizId}/comments`)
  return await response.json()
}
```

**修正後**

```js
async function fetchQuiz(quizId)    { /* GET /quizzes/{id}（コメント込み） */ }
async function fetchComments(quizId){ /* GET /quizzes/{id}/comments      */ }
```

**理由**: JavaScript は同名関数を後勝ちで上書きします。元のままだと `fetchQuiz` は
常にコメントを返し、`talktopics()` が呼ぶ `fetchComments` は**未定義**で実行時エラーに
なります。役割ごとに別名へ分離しました。

> ついでに URL の `quizzes${quizId}` は **`/` 抜け**（`/quizzes5` になる）でした。
> `/quizzes/${quizId}` に修正しています。

---

### 1-2. API の URL がバラバラ → `CONFIG.API_BASE` に一本化

**元コード**（3種類の宛先が混在）

```js
fetch("http://192.168.0.52:8000/quizzes")                 // 一覧だけ LAN 直
fetch("https://ide1-f7e17516.sukimaru.net/proxy/8099/...")// 個別/投稿/コメントはプロキシ
fetch("https://api-65ee86aa.sukimaru.net/posts/...")      // 削除は別サービス
```

**修正後**

```js
const CONFIG = { API_BASE: "https://ide1-f7e17516.sukimaru.net/proxy/8099", /* ... */ };
const apiUrl = (path) => `${CONFIG.API_BASE.replace(/\/+$/, "")}${path}`;
```

**理由**: 宛先が散らばっていると保守できず、特に **https のページから http API を呼ぶと
ブラウザが「混在コンテンツ」としてブロック**します。設定を1か所に集約し、環境ごとに
ここだけ書き換えれば済むようにしました。`api-65ee86aa.../posts` は別サービスで、
このバックエンドには存在しないため撤去しました。

---

### 1-3. クイズの作成者は `author` ではなく `owner`

**元コード**

```js
<div class="list-author">${quiz.author.username}</div>
```

**修正後**

```js
<div class="list-author">${esc(quiz.owner?.username)}</div>
```

**理由**: バックエンドの `QuizRead` は作成者を **`owner`** で返します（`author` を持つのは
コメントだけ）。元のままだと `quiz.author` が `undefined` で落ちます。

---

### 1-4. `login()` が未定義 → Keycloak ログインを実装

**元コード**（`login` はどこにも定義が無い）

```js
await login(username, password)   // ReferenceError
```

**修正後**（OAuth2 password grant で Keycloak からトークン取得）

```js
async function login(username, password) {
  const body = new URLSearchParams({
    grant_type: "password", client_id: CONFIG.CLIENT_ID, username, password, scope: "openid",
  });
  const res = await fetch(`${CONFIG.KEYCLOAK_BASE}/realms/${CONFIG.REALM}/protocol/openid-connect/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error("なまえ または パスワードが正しくありません");
  setToken((await res.json()).access_token);   // sessionStorage に保存
}
```

**理由**: このバックエンドは**認証を Keycloak に委譲**しており、ログインEPを持ちません。
よってフロントが Keycloak のトークンEPを直接叩いてアクセストークンを得る必要があります。

---

### 1-5. 認証ヘッダが無い → `Authorization: Bearer` を付与

**元コード**（投稿・コメント・削除すべてトークン無し）

```js
fetch(".../quizzes", { method: "POST", headers: { "Content-Type": "application/json" }, body })
```

**修正後**

```js
function authHeaders(extra = {}) {
  const h = { ...extra }; const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`; return h;
}
fetch(apiUrl("/quizzes"), { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body })
```

**理由**: 保護API（作成・コメント・削除・`/auth/me`）はトークンが無いと **401** になります。
全ての保護リクエストに Bearer を付け、401 を受けたら自動ログアウトするようにしました。

---

### 1-6. 投稿フォームの不具合（id 重複・無効カテゴリ・answer_index）

**元コード**

```html
<select id ="answer_index" class="category-select">   <!-- カテゴリなのに id が answer_index -->
  <option value="programming">プログラミング</option>  <!-- バックエンドに無い値 -->
  <option value="security">セキュリティ</option>       <!-- バックエンドに無い値 -->
</select>
...
<select id ="answer_index" class="answer-select">      <!-- id が重複 -->
  <option value="1">1番</option> ...                   <!-- 1 始まり -->
</select>
```
```js
const category = document.querySelector("#category").value   // #category は存在しない → null.value で落ちる
const answer_index = document.querySelector("#answer_index").value
```

**修正後**

```html
<select id="category"     class="category-select"> … sns/internet/ai/java/python/html …</select>
<select id="answer_index" class="answer-select">
  <option value="0">1番</option> <option value="1">2番</option> …  <!-- 0 始まり -->
</select>
```
```js
const category = document.querySelector("#category").value;            // 正しい id
const answer_index = Number(document.querySelector("#answer_index").value); // 0 始まり
const raw = [1,2,3,4].map(i => document.querySelector(`#opt${i}`).value.trim());
const choices = raw.filter(c => c !== "");                              // 空欄は除外
const finalAnswerIndex = choices.indexOf(raw[answer_index]);           // 除外後の位置に補正
```

**理由**:
- `id` が `answer_index` で**重複**していたため `#category` が取得できず送信時に落ちていました。
- カテゴリ値 `programming` / `security` は**バックエンドの許可値に無い**ため 422 になります。
  許可値に合わせました。
- `answer_index` はバックエンドが **0 始まり**（かつ件数未満）。1始まりのままだと範囲外で 422。
  さらに「空欄の選択肢を除外」した後でも正解番号がズレないよう、正解の**文字列**から
  index を取り直しています。

---

### 1-7. クイズ詳細：ルートが無い＋存在しないフィールド参照

**元コード**（`#/quizzes/{id}` のルートが無く、画像/本文前提で描画）

```js
<img class="detail-image" src="${getImageSrc(article.image_base64)}" ... />  // getImageSrc 未定義
<p class="detail-body">${article.body}</p>                                    // body は無い
```

**修正後**（実在フィールドで描画。`GET /quizzes/{id}` はコメント込みで返る）

```js
const detailMatch = hash.match(/^#\/quizzes\/(.+)$/);   // ルーティングに追加
// 描画: question / choices(正解をハイライト) / explanation / owner / comments
<ol class="detail-choices">${quiz.choices.map((c,i)=>
  `<li class="${i===quiz.answer_index?'correct':''}">${esc(c)}</li>`).join("")}</ol>
<p class="detail-answer">⭕️ 正解: ${quiz.answer_index + 1}番</p>
```

**理由**: 詳細は別データモデル（記事/画像/本文）向けのコードでした。`getImageSrc` も
`image_base64`/`body` もこのアプリには存在しません。クイズの実フィールドに置き換え、
一覧からの `#/quizzes/{id}` 遷移を**ルーティングに追加**しました。

---

### 1-8. 削除：別サービス → `DELETE /quizzes/{id}`（認証・所有者）

**元コード**

```js
fetch(`https://api-65ee86aa.sukimaru.net/posts/${postId}`, { method: "DELETE" });
```

**修正後**

```js
fetch(apiUrl(`/quizzes/${quizId}`), { method: "DELETE", headers: authHeaders() });
// 403 のときは「自分のクイズしか削除できません」を表示。所有者のときだけ削除ボタンを出す
```

**理由**: 宛先が別サービスかつ `/posts`（存在しないパス）でした。正しい削除APIに変更し、
バックエンドの「所有者のみ削除可」に合わせて UI と権限処理を実装しました。

---

### 1-9. カテゴリ閲覧が機能していない → `#/category/:cat` で絞り込み

**元コード**: トップのカードは `#/AI` `#/SNS` `#/security` 等にリンクするが、`renderApp` は
`#/programming` しか処理せず、他は全て素通りでカテゴリ一覧に戻っていました。

**修正後**

```js
const categoryMatch = hash.match(/^#\/category\/(.+)$/);
// カード → #/category/ai, #/category/sns, … → renderQuizList(cat) で GET /quizzes?category=cat
```

**理由**: カテゴリを押しても絞り込み一覧に行けるよう、`#/category/:cat` ルートと
バックエンドの `?category=` フィルタを接続しました。許可値に無い「JavaScript / CSS」は
一覧から外しています（必要なら `app/enums.py` に1行追加で復活可能）。

---

### 1-10. その他の堅牢化

- **`esc()` で HTML エスケープ**: ユーザー入力（タイトル・コメント等）をそのまま
  `innerHTML` に流すと表示が壊れたり XSS の恐れがあるため、全差し込み箇所をエスケープ。
- **`reverse()` を削除**: バックエンドは既に新着順（`created_at desc`）で返すため、
  反転すると逆に古い順になっていました。
- **ログイン/ログアウト表示の切替**・**`requireLogin()` ガード**・**エラーメッセージ表示**
  ・**読み込み中表示**を追加。

---

## 2. HTML（index.html）

| 変更 | 元 | 修正後 | 理由 |
|------|----|--------|------|
| ログインリンクに id 付与 | `<a href="#/login" class="titlebutton">ログイン</a>` | `<a href="#/login" id="auth-link" …>` | JS からログイン⇔ログアウト表示を切り替えるため |
| タイトルのリンク先 | `<a href="index.html">` | `<a href="#/">` | SPA 内遷移にしてフルリロードを避ける |
| `<script>` の位置 | `<body>` 先頭 | `<head>` 内（`defer` 維持） | 体裁の整理（`defer` なので実行タイミングは同じ） |

> 構造（検索ボックス・タイトルボタン・`#app`・サイドバー）は元のまま維持しています。

---

## 3. CSS（style.css）

**元ファイルは空**でした。`index.html` と `app.js` が使うクラスに対して、スタイルを
**新規に作成**しています。

- 対応クラス例: `.container` `.titlebutton` `.layout` `.sidebar`
  `.article-list` `.article-card` `.article_block` `.list-title` `.cat-badge`
  `.quiz-container` `.choice` `.submit-btn` `.detail-*` `.comment-*`
  `.topic-box` `.login-*` `.community-table` `.deletebutton` `.error` など
- 方針: カード型グリッド・角丸・アクセントカラー・レスポンシブ
  （760px 以下でサイドバー非表示、640px 以下でフォーム1カラム）。
- 追加した HTML 要素にもクラスを用意: 正解ハイライト（`.detail-choices li.correct`）、
  カテゴリバッジ（`.cat-badge`）、エラー表示（`.error`）など。

**理由**: 空のままでは無スタイルで表示崩れするため、既存のクラス名に合わせて
見た目を整えました（クラス名は元コードの命名を尊重しています）。

---

## まとめ

変更はおおむね次の3点に集約されます。

1. **バックエンドの実際の契約に合わせた**（`owner` / 0始まり `answer_index` /
   `category` 許可値 / コメント込み詳細 / 削除API）。
2. **認証を成立させた**（Keycloak password grant でログイン →
   保護APIに Bearer トークンを付与）。
3. **壊れ・未定義・重複を除去し堅牢化した**（重複関数・未定義参照・URL散在・
   エスケープ・ルーティング不足）。
