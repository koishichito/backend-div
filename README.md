# Quiz SNS API

FastAPI + Keycloak(JWT / RS256)+ MySQL のクイズ SNS バックエンド。

## 構成(3 台)

| サーバ | 役割 | ポート |
|--------|------|--------|
| 192.168.0.51 (dev-web) | Keycloak(Docker, realm/client = `test`) | 8080 |
| 192.168.0.52 (dev-app) | 本バックエンド(FastAPI) | 8000 |
| 192.168.0.53 (dev-db)  | MySQL / MariaDB(`quiz_db`) | 3306 |

トークン検証は `KEYCLOAK_SERVER_URL` から `issuer` と JWKS URL を導出して行う。
バックエンド(52)は **51:8080(JWKS 取得)** と **53:3306(DB)** へ到達できる必要がある。

## 前提(クローン前に各サーバで済ませること)

### 52(本機)
- Python 3.10 以上。`X | None` 構文を使うため 3.9 では起動しない。
  RHEL 9 系の既定は 3.9 なので `sudo dnf install -y python3.11` 等で導入する。

### 53(DB)
```sql
CREATE DATABASE IF NOT EXISTS quiz_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'quiz_user'@'192.168.0.52' IDENTIFIED BY 'quiz_pass';
GRANT ALL PRIVILEGES ON quiz_db.* TO 'quiz_user'@'192.168.0.52';
FLUSH PRIVILEGES;
```
- `bind-address` を `0.0.0.0`(または `192.168.0.53`)にして再起動
- ファイアウォールで 3306 を 52 から許可
- テーブルは本アプリ起動時に自動作成される(手動 DDL は不要)

### 51(Keycloak)
realm `test` / client `test`(public・Direct Access Grants 有効)/ ユーザを作成済みであること。
未作成なら kcadm で:
```bash
docker exec keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin --password admin
docker exec keycloak /opt/keycloak/bin/kcadm.sh create realms -s realm=test -s enabled=true
docker exec keycloak /opt/keycloak/bin/kcadm.sh create clients -r test \
  -s clientId=test -s enabled=true -s publicClient=true \
  -s directAccessGrantsEnabled=true -s standardFlowEnabled=true \
  -s 'redirectUris=["http://localhost:5173/*","http://localhost:3000/*"]' \
  -s 'webOrigins=["+"]'
docker exec keycloak /opt/keycloak/bin/kcadm.sh create users -r test \
  -s username=testuser -s enabled=true -s emailVerified=true
docker exec keycloak /opt/keycloak/bin/kcadm.sh set-password -r test \
  --username testuser --new-password testpass
```

## セットアップ(52 で)

```bash
git clone <このリポジトリ>
cd backend-div

python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # 値を確認・編集

uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` は他ホストから到達させるため。52 の 8000 もファイアウォールで開ける。
起動時に 53 へ接続してテーブルを作成するので、ここで DB 接続が実地検証される。

## 動作確認(end-to-end)

```bash
TOKEN=$(curl -s http://192.168.0.51:8080/realms/test/protocol/openid-connect/token \
  -d grant_type=password -d client_id=test \
  -d username=testuser -d password=testpass | jq -r .access_token)

curl -s http://192.168.0.52:8000/auth/me -H "Authorization: Bearer $TOKEN" | jq .
```

`/auth/me` は「JWT 検証(issuer 一致 + 51 から JWKS 取得)→ ユーザの自動登録(53 へ INSERT)」を
一度に通すため、ユーザ情報が返れば 3 台連携が成立している。

- 401 → JWT/JWKS 系。52→51:8080 の到達性、`KEYCLOAK_SERVER_URL` の値を確認。
- 500(DB 例外)→ MySQL 系。52→53:3306 の到達性、`bind-address`、権限、`quiz_db` 存在を確認。

## API

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| GET | `/` | 不要 | ヘルスチェック |
| GET | `/auth/me` | 要 | 自分のユーザ情報 |
| GET | `/quizzes` | 不要 | クイズ一覧(`skip` / `limit` / `category`) |
| POST | `/quizzes` | 要 | クイズ作成(`category` 必須) |
| GET | `/quizzes/{id}` | 不要 | クイズ詳細(コメント込み) |
| DELETE | `/quizzes/{id}` | 要(所有者のみ) | クイズ削除 |
| GET | `/quizzes/{id}/comments` | 不要 | コメント一覧 |
| POST | `/quizzes/{id}/comments` | 要 | コメント投稿 |

OpenAPI ドキュメント: `http://192.168.0.52:8000/docs`

## カテゴリー

クイズは `category` 属性(作成時 **必須**)を持つ。許可値は
**`sns` / `internet` / `ai` / `java` / `python` / `html`**
(列挙型 + DB の CHECK 制約で担保。MySQL / SQLite どちらでも移植可能。
値の追加は `app/enums.py` の `QuizCategory` にメンバーを 1 行足すだけ)。

```bash
# 作成(category を含める。不正値は 422)
curl -s -X POST http://192.168.0.52:8000/quizzes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"...","question":"...","choices":["A","B"],"answer_index":0,"category":"ai"}'

# 絞り込み(未指定なら全件)
curl -s "http://192.168.0.52:8000/quizzes?category=sns"
```

> 注: 既存の MySQL に列を追加する場合、本アプリの `create_all` は既存テーブルを変更しないため、
> 別途 `ALTER TABLE quizzes ADD COLUMN category VARCHAR(20) ...` が必要(新規 DB では自動作成される)。

## フロントエンド(ログイン)

`frontend/` に、ユーザー名(またはメール)+ パスワードでログインする最小画面を同梱。
このバックエンドは認証を Keycloak に委譲しているため、フロントは **Keycloak のトークン
エンドポイントを直接叩いて**(password grant)アクセストークンを取得し、それを Bearer
トークンとして本 API(`/auth/me` 等)に付与する。

- `frontend/config.js` … Keycloak / API の接続先(環境に合わせて編集)
- `frontend/auth.js` … `login()` / `logout()` / `apiFetch()` / `getCurrentUser()`
- `frontend/index.html` … ログインフォーム

```bash
# 例: 開発時はフロントを 5173 等で配信(CORS_ORIGINS / Keycloak webOrigins に要登録)
cd frontend && python -m http.server 5173
```

## メモ

- `start-dev` 運用では issuer がアクセス経路の host に追従する。ブラウザログイン
  (authorization code フロー)を追加する際、ブラウザが 51:8080 に直接届くなら
  Keycloak を `KC_HOSTNAME=http://192.168.0.51:8080` で起動して issuer を固定すると、
  経路差による `iss` 不一致を防げる。公開プロキシ経由でしか届かない場合は issuer と
  JWKS のベース URL を分離する改修が必要。
- リバースプロキシ配下に置く場合のみ `ROOT_PATH`(例 `/proxy/8099`)を設定する。
  直接公開時に設定すると `/docs` の Try it out が壊れる。
