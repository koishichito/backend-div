import enum


class QuizCategory(str, enum.Enum):
    """クイズのカテゴリー。許可値は以下のメンバーのみ。

    値を増やす場合はこの列挙体にメンバーを 1 行追加するだけでよい
    (スキーマのバリデーション・DB の CHECK 制約・OpenAPI の enum が
    自動的に追従する)。

    str を継承しているので、JSON シリアライズ時はそのまま "sns" 等の
    文字列値になり、DB にも文字列として保存される。
    """

    sns = "sns"
    internet = "internet"
    ai = "ai"
    java = "java"
    python = "python"
    html = "html"
