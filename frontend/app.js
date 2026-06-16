// =====================================================================
//  Quiz IT — フロントエンド (バックエンド: FastAPI + Keycloak)
// =====================================================================
//  ▼▼▼ 環境に合わせてここだけ書き換える ▼▼▼
const CONFIG = {
  // FastAPI バックエンドのベース URL。
  //  - LAN 直結なら "http://192.168.0.52:8000"
  //  - リバースプロキシ経由なら "https://ide1-xxxx.sukimaru.net/proxy/8099"
  // 注意: この画面を https で開く場合、http の API は混在コンテンツとして
  //       ブラウザにブロックされる。必ず https 側の URL を入れること。
  API_BASE: "https://ide1-f7e17516.sukimaru.net/proxy/8099",

  // Keycloak(ブラウザから直接トークンを取りに行く公開 URL)
  KEYCLOAK_BASE: "http://192.168.0.51:8080",
  REALM: "test",
  CLIENT_ID: "fastapi-client", // public クライアント(Direct Access Grants 有効)
};
//  ▲▲▲ ここまで ▲▲▲

// カテゴリーの定義(バックエンドの enum と一致させること)
const CATEGORIES = {
  sns: "📱 ネットリテラシー",
  internet: "🛡️ インターネット",
  ai: "🤖 AI",
  java: "☕ Java",
  python: "🐍 Python",
  html: "🧱 HTML",
};

const app = document.querySelector("#app");

// ---------------------------------------------------------------------
//  小物ユーティリティ
// ---------------------------------------------------------------------
const apiUrl = (path) => `${CONFIG.API_BASE.replace(/\/+$/, "")}${path}`;

// innerHTML に値を差し込む箇所は必ずエスケープ(壊れ・XSS 対策)
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}

// ---------------------------------------------------------------------
//  認証(Keycloak password grant でトークン取得 → sessionStorage 保存)
// ---------------------------------------------------------------------
const TOKEN_KEY = "quizit.accessToken";
const getToken = () => sessionStorage.getItem(TOKEN_KEY);
const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);
const isLoggedIn = () => !!getToken();

function authHeaders(extra = {}) {
  const h = { ...extra };
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

async function login(username, password) {
  const url = `${CONFIG.KEYCLOAK_BASE.replace(/\/+$/, "")}/realms/${CONFIG.REALM}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: CONFIG.CLIENT_ID,
    username,
    password,
    scope: "openid",
  });

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (_) {
    throw new Error("Keycloak に接続できません。URL / CORS(webOrigins) 設定を確認してください。");
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 400) {
      throw new Error("なまえ または パスワードが正しくありません");
    }
    throw new Error(`ログインに失敗しました (HTTP ${res.status})`);
  }

  const data = await res.json();
  setToken(data.access_token);
  updateAuthLink();
  return data;
}

function logout() {
  clearToken();
  updateAuthLink();
}

// ヘッダのログイン/ログアウト表示を切り替える
function updateAuthLink() {
  const link = document.querySelector("#auth-link");
  if (!link) return;
  if (isLoggedIn()) {
    link.textContent = "ログアウト";
    link.setAttribute("href", "#/logout");
  } else {
    link.textContent = "ログイン";
    link.setAttribute("href", "#/login");
  }
}

// 認証が要るページ/操作のガード
function requireLogin() {
  if (!isLoggedIn()) {
    alert("この操作にはログインが必要です。");
    location.hash = "#/login";
    return false;
  }
  return true;
}

async function getCurrentUser() {
  if (!isLoggedIn()) return null;
  const res = await fetch(apiUrl("/auth/me"), { headers: authHeaders() });
  if (res.status === 401) {
    clearToken();
    updateAuthLink();
    return null;
  }
  if (!res.ok) return null;
  return res.json();
}

// ---------------------------------------------------------------------
//  API 呼び出し
// ---------------------------------------------------------------------
async function fetchQuizzes(category) {
  const q = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await fetch(apiUrl(`/quizzes${q}`));
  if (!res.ok) throw new Error("クイズ一覧の取得に失敗しました");
  return res.json();
}

async function fetchQuiz(quizId) {
  // 個別クイズ(コメント込みで返る: QuizReadWithComments)
  const res = await fetch(apiUrl(`/quizzes/${quizId}`));
  if (!res.ok) throw new Error("クイズの取得に失敗しました");
  return res.json();
}

async function fetchComments(quizId) {
  const res = await fetch(apiUrl(`/quizzes/${quizId}/comments`));
  if (!res.ok) throw new Error("コメントの取得に失敗しました");
  return res.json();
}

async function postQuiz({ title, question, category, choices, answer_index }) {
  const res = await fetch(apiUrl("/quizzes"), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ title, question, category, choices, answer_index }),
  });
  if (res.status === 401) { clearToken(); updateAuthLink(); throw new Error("ログインが必要です"); }
  if (!res.ok) {
    const msg = await readError(res);
    throw new Error(`クイズ投稿に失敗しました${msg}`);
  }
  return res.json();
}

async function postComment(quizId, bodyText) {
  const res = await fetch(apiUrl(`/quizzes/${quizId}/comments`), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ body: bodyText }),
  });
  if (res.status === 401) { clearToken(); updateAuthLink(); throw new Error("ログインが必要です"); }
  if (!res.ok) throw new Error("コメント投稿に失敗しました");
  return res.json();
}

async function deleteQuiz(quizId) {
  const res = await fetch(apiUrl(`/quizzes/${quizId}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (res.status === 401) { clearToken(); updateAuthLink(); throw new Error("ログインが必要です"); }
  if (res.status === 403) throw new Error("自分のクイズしか削除できません");
  if (!res.ok && res.status !== 204) throw new Error("削除に失敗しました");
  return true;
}

// 422 等のエラー詳細を読み取る
async function readError(res) {
  try {
    const j = await res.json();
    const d = j.detail;
    if (typeof d === "string") return `: ${d}`;
    if (Array.isArray(d)) return `: ${d.map((e) => e.msg).join(", ")}`;
  } catch (_) {}
  return ` (HTTP ${res.status})`;
}

// ---------------------------------------------------------------------
//  画面: カテゴリー一覧(トップ)
// ---------------------------------------------------------------------
function renderCategoryTop() {
  app.innerHTML = `
<div class="article-list">
  <article class="article-card">
    <a href="#/programming">
      <div class="article_block"><h1 class="list-title"><span class="cat-emoji">💻</span><br>プログラミング</h1></div>
    </a>
  </article>
  <article class="article-card">
    <a href="#/category/ai">
      <div class="article_block"><h1 class="list-title"><span class="cat-emoji">🤖</span><br>AI</h1></div>
    </a>
  </article>
  <article class="article-card">
    <a href="#/category/sns">
      <div class="article_block"><h1 class="list-title"><span class="cat-emoji">📱</span><br>ネットリテラシー</h1></div>
    </a>
  </article>
  <article class="article-card">
    <a href="#/category/internet">
      <div class="article_block"><h1 class="list-title"><span class="cat-emoji">🛡️</span><br>インターネット</h1></div>
    </a>
  </article>
  <a href="#/talktopic" class="topicbutton">トークテーマ</a>
</div>`;
}

// 画面: プログラミングのサブカテゴリー
function renderProgramming() {
  app.innerHTML = `
<div class="article-list">
  <article class="article-card">
    <a href="#/category/java"><div class="article_block"><h1 class="list-title"><span class="cat-emoji">☕</span><br>Java</h1></div></a>
  </article>
  <article class="article-card">
    <a href="#/category/python"><div class="article_block"><h1 class="list-title"><span class="cat-emoji">🐍</span><br>Python</h1></div></a>
  </article>
  <article class="article-card">
    <a href="#/category/html"><div class="article_block"><h1 class="list-title"><span class="cat-emoji">🧱</span><br>HTML</h1></div></a>
  </article>
</div>`;
}

// ---------------------------------------------------------------------
//  画面: クイズ一覧(category 指定で絞り込み)
// ---------------------------------------------------------------------
async function renderQuizList(category) {
  app.innerHTML = `<p>読み込み中…</p>`;
  let quizzes;
  try {
    quizzes = await fetchQuizzes(category);
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }

  const heading = category
    ? `${esc(CATEGORIES[category] || category)} のクイズ`
    : "クイズ一覧";

  if (quizzes.length === 0) {
    app.innerHTML = `<h2>${heading}</h2><p>まだクイズがありません。</p>`;
    return;
  }

  const cards = quizzes.map((quiz) => {
    const date = (quiz.created_at || "").split("T")[0];
    return `
<article class="article-card">
  <a href="#/quizzes/${quiz.id}">
    <div class="article_block">
      <div class="list-datenauthor">
        <div class="list-date">${esc(date)}</div>
        <div class="list-author">${esc(quiz.owner?.username)}</div>
      </div>
      <span class="cat-badge">${esc(CATEGORIES[quiz.category] || quiz.category)}</span>
      <h1 class="list-title">${esc(quiz.title)}</h1>
    </div>
  </a>
</article>`;
  }).join("");

  app.innerHTML = `<h2>${heading}</h2><section class="article-list">${cards}</section>`;
}

// 検索結果
function renderSearchResult(results) {
  if (results.length === 0) {
    app.innerHTML = `<h2>検索結果</h2><p>該当するクイズがありませんでした。</p>`;
    return;
  }
  const html = results.map((quiz) => `
    <div class="quiz-item">
      <h3>${esc(quiz.title)}</h3>
      <p>${esc(quiz.question)}</p>
      <a href="#/quizzes/${quiz.id}">詳細を見る</a>
    </div>`).join("");
  app.innerHTML = `<h2>検索結果</h2><div class="quiz-list">${html}</div>`;
}

// ---------------------------------------------------------------------
//  画面: クイズ作成フォーム
// ---------------------------------------------------------------------
function renderCreateQuiz() {
  if (!requireLogin()) return;

  const options = Object.entries(CATEGORIES)
    .map(([value, label]) => `<option value="${value}">${esc(label)}</option>`)
    .join("");

  app.innerHTML = `
<form id="post-form">
  <div class="quiz-container">
    <div class="left-group">
      <div class="tytle-form">
        <label>📍 タイトル</label><br>
        <input type="text" id="title" class="form-text title-input" required>
      </div>
      <label>📝 問題文</label><br>
      <textarea rows="4" id="question" placeholder="ここにもんだいをかいてね！" class="form-text" required></textarea>
      <div class="category-area">
        <label class="category-label">🔗 カテゴリ</label><br>
        <select id="category" class="category-select">${options}</select>
      </div>
    </div>
    <div class="right-group">
      <label>💡 選択肢</label><br>
      <div class="choice"><span class="choice-num">1</span><input type="text" id="opt1" placeholder="答え1" class="form-text"></div>
      <div class="choice"><span class="choice-num">2</span><input type="text" id="opt2" placeholder="答え2" class="form-text"></div>
      <div class="choice"><span class="choice-num">3</span><input type="text" id="opt3" placeholder="答え3" class="form-text"></div>
      <div class="choice"><span class="choice-num">4</span><input type="text" id="opt4" placeholder="答え4" class="form-text"></div>
      <div class="answer-area">
        <label class="answer-label">⭕️ 答えはどれ？</label><br>
        <select id="answer_index" class="answer-select">
          <option value="0">1番</option>
          <option value="1">2番</option>
          <option value="2">3番</option>
          <option value="3">4番</option>
        </select>
      </div>
      <div class="submit-area">
        <button type="submit" class="submit-btn">✨ クイズを登録する！</button>
      </div>
      <p id="form-msg" class="error"></p>
    </div>
  </div>
</form>`;

  document.querySelector("#post-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = document.querySelector("#form-msg");
    msg.textContent = "";

    const title = document.querySelector("#title").value.trim();
    const question = document.querySelector("#question").value.trim();
    const category = document.querySelector("#category").value;
    const answer_index = Number(document.querySelector("#answer_index").value); // 0 始まり

    // 入力された選択肢だけ採用(空欄は除外)
    const raw = [1, 2, 3, 4].map((i) => document.querySelector(`#opt${i}`).value.trim());
    const choices = raw.filter((c) => c !== "");

    if (choices.length < 2) {
      msg.textContent = "選択肢は2つ以上入力してください。";
      return;
    }
    if (answer_index >= raw.length || raw[answer_index] === "") {
      msg.textContent = "「答え」は、入力済みの選択肢の番号にしてください。";
      return;
    }
    // 空欄除外で番号がずれないよう、正解の文字列から最終 index を求め直す
    const finalAnswerIndex = choices.indexOf(raw[answer_index]);

    try {
      await postQuiz({ title, question, category, choices, answer_index: finalAnswerIndex });
      location.hash = "#/quizzes";
    } catch (e) {
      msg.textContent = e.message;
    }
  });
}

// ---------------------------------------------------------------------
//  画面: クイズ詳細(コメント・削除込み)
// ---------------------------------------------------------------------
async function renderDetailPage(quizId) {
  app.innerHTML = `<p>読み込み中…</p>`;
  let quiz;
  try {
    quiz = await fetchQuiz(quizId);
  } catch (e) {
    app.innerHTML = `<p class="error">クイズが見つかりませんでした。</p>`;
    return;
  }

  const date = (quiz.created_at || "").split("T")[0];
  const choicesHTML = quiz.choices
    .map((c, i) => `<li class="${i === quiz.answer_index ? "correct" : ""}">${esc(c)}</li>`)
    .join("");

  const comments = quiz.comments || [];
  const commentsHTML = comments.length
    ? comments.map((c) => `
        <div class="comment-item">
          <div class="comment-author">${esc(c.author?.username)}</div>
          <div class="comment-body">${esc(c.body)}</div>
        </div>`).join("")
    : `<p>まだコメントがありません</p>`;

  const me = await getCurrentUser();
  const canDelete = me && quiz.owner && me.id === quiz.owner.id;

  app.innerHTML = `
<div class="detail-articles">
  <div class="detail-datenauthor">
    <div class="detail-date">${esc(date)}</div>
    <div class="detail-author">${esc(quiz.owner?.username)}</div>
  </div>
  <span class="cat-badge">${esc(CATEGORIES[quiz.category] || quiz.category)}</span>
  <h1 class="detail-title">${esc(quiz.title)}</h1>
  <p class="detail-question">${esc(quiz.question)}</p>
  <ol class="detail-choices">${choicesHTML}</ol>
  <p class="detail-answer">⭕️ 正解: ${quiz.answer_index + 1}番</p>
  ${quiz.explanation ? `<p class="detail-explanation">💡 ${esc(quiz.explanation)}</p>` : ""}
</div>

<h3>💬 コメント (${comments.length})</h3>
<div class="comment-list">${commentsHTML}</div>

<h3>✏️ コメントを書く</h3>
<form id="comment-form">
  <textarea id="comment-text" class="comment-input" placeholder="コメントを入力"></textarea>
  <button type="submit" class="comment-submit">送信</button>
  <p id="comment-msg" class="error"></p>
</form>

${canDelete ? `<form id="delete-form"><button type="submit" class="deletebutton">このクイズを削除</button></form>` : ""}`;

  document.querySelector("#comment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requireLogin()) return;
    const text = document.querySelector("#comment-text").value.trim();
    if (!text) return;
    try {
      await postComment(quizId, text);
      renderDetailPage(quizId); // 再描画して反映
    } catch (e) {
      document.querySelector("#comment-msg").textContent = e.message;
    }
  });

  const deleteForm = document.querySelector("#delete-form");
  if (deleteForm) {
    deleteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!confirm("本当に削除しますか？")) return;
      try {
        await deleteQuiz(quizId);
        location.hash = "#/quizzes";
      } catch (e) {
        alert(e.message);
      }
    });
  }
}

// ---------------------------------------------------------------------
//  画面: トークテーマ(ランダムなクイズ + コメント)
// ---------------------------------------------------------------------
async function renderTalkTopic() {
  app.innerHTML = `<p>読み込み中…</p>`;
  let quizzes;
  try {
    quizzes = await fetchQuizzes();
  } catch (e) {
    app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  if (!quizzes.length) {
    app.innerHTML = `<h2>今日のトークテーマ</h2><p>クイズがまだありません。</p>`;
    return;
  }

  const randomQuiz = quizzes[Math.floor(Math.random() * quizzes.length)];
  const quizId = randomQuiz.id;
  const comments = await fetchComments(quizId).catch(() => []);

  const commentsHTML = comments.length
    ? comments.map((c) => `
        <div class="comment-item">
          <div class="comment-author">${esc(c.author?.username)}</div>
          <div class="comment-body">${esc(c.body)}</div>
        </div>`).join("")
    : `<p>まだコメントがありません</p>`;

  app.innerHTML = `
<h2>今日のトークテーマ</h2>
<div class="topic-box"><p class="topic-question">${esc(randomQuiz.question)}</p></div>
<h3>💬 コメント一覧</h3>
<div class="comment-list">${commentsHTML}</div>
<h3>✏️ コメントを書く</h3>
<form id="comment-form">
  <textarea id="comment-text" class="comment-input" placeholder="コメントを入力"></textarea>
  <button type="submit" class="comment-submit">送信</button>
  <p id="comment-msg" class="error"></p>
</form>`;

  document.querySelector("#comment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requireLogin()) return;
    const text = document.querySelector("#comment-text").value.trim();
    if (!text) return;
    try {
      await postComment(quizId, text);
      renderTalkTopic();
    } catch (e) {
      document.querySelector("#comment-msg").textContent = e.message;
    }
  });
}

// ---------------------------------------------------------------------
//  画面: ログイン
// ---------------------------------------------------------------------
function renderLoginPage() {
  app.innerHTML = `
<div class="login-container">
  <h2 class="login-title">🔑 ログイン</h2>
  <form id="login-form">
    <input type="text" id="username" class="login-input" placeholder="👤 なまえ または メール" autocomplete="username"><br>
    <input type="password" id="password" class="login-input" placeholder="🔒 パスワード" autocomplete="current-password"><br>
    <button type="submit" class="login-submit">✨ ログインする！</button>
  </form>
  <p id="login-msg" class="error"></p>
</div>`;

  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = document.querySelector("#login-msg");
    msg.textContent = "";
    const username = document.querySelector("#username").value.trim();
    const password = document.querySelector("#password").value;
    try {
      await login(username, password);
      location.hash = "#/";
    } catch (e) {
      msg.textContent = e.message;
    }
  });
}

// ---------------------------------------------------------------------
//  画面: コミュニティ
// ---------------------------------------------------------------------
function renderCommunity() {
  app.innerHTML = `
<h1>先端小学校</h1>
<h2>教師</h2>
<table class="community-table">
  <thead><tr><th>名前</th></tr></thead>
  <tbody><tr><td>kamidouzono</td></tr><tr><td>kawata</td></tr><tr><td>tuda</td></tr></tbody>
</table>
<h2>生徒</h2>
<table class="community-table">
  <thead><tr><th>名前</th><th>学年</th></tr></thead>
  <tbody>
    <tr><td>tamaoki</td><td>6年</td></tr>
    <tr><td>yoshioka</td><td>2年</td></tr>
    <tr><td>ogasapara</td><td>4年</td></tr>
    <tr><td>sugihara</td><td>1年</td></tr>
    <tr><td>saitou</td><td>3年</td></tr>
  </tbody>
</table>`;
}

// ---------------------------------------------------------------------
//  ルーティング
// ---------------------------------------------------------------------
function renderApp() {
  const hash = location.hash || "#/";
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) sidebar.style.display = "block";

  updateAuthLink();

  const detailMatch = hash.match(/^#\/quizzes\/(.+)$/);
  const categoryMatch = hash.match(/^#\/category\/(.+)$/);

  if (hash === "#/logout") {
    logout();
    location.hash = "#/";
    return;
  }
  if (hash === "#/quizzes" || hash === "#/quizzes/") {
    renderQuizList();
  } else if (detailMatch) {
    renderDetailPage(decodeURIComponent(detailMatch[1]));
  } else if (categoryMatch) {
    renderQuizList(decodeURIComponent(categoryMatch[1]));
  } else if (hash === "#/new") {
    renderCreateQuiz();
  } else if (hash === "#/login") {
    renderLoginPage();
    if (sidebar) sidebar.style.display = "none";
  } else if (hash === "#/programming") {
    renderProgramming();
  } else if (hash === "#/talktopic") {
    renderTalkTopic();
  } else if (hash === "#/community") {
    renderCommunity();
  } else {
    renderCategoryTop();
  }
}

window.addEventListener("hashchange", renderApp);
window.addEventListener("DOMContentLoaded", renderApp);
// defer 読み込みのため DOM は既に構築済み。即時にも一度描画。
renderApp();

// 検索ボタン
const searchBtn = document.querySelector("#btnLoadUsers");
if (searchBtn) {
  searchBtn.addEventListener("click", async () => {
    const keyword = document.querySelector("#search").value.trim();
    try {
      const quizzes = await fetchQuizzes();
      const filtered = quizzes.filter((q) =>
        q.title.toLowerCase().includes(keyword.toLowerCase())
      );
      renderSearchResult(filtered);
    } catch (e) {
      app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  });
}
