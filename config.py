"""
환경변수 설정 관리
"""
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # Anthropic
    anthropic_api_key: str = Field(..., env="ANTHROPIC_API_KEY")
    anthropic_model: str = "claude-sonnet-4-20250514"

    # Google Sheets 연결 방식 선택
    apps_script_url: str = Field("", env="APPS_SCRIPT_URL")
    google_service_account_file: str = Field("", env="GOOGLE_SERVICE_ACCOUNT_FILE")
    spreadsheet_id: str = Field("", env="SPREADSHEET_ID")

    # 앱 설정
    app_env: str = Field("development", env="APP_ENV")
    log_level: str = Field("INFO", env="LOG_LEVEL")

    # 텔레그램
    telegram_bot_token: str = Field("", env="TELEGRAM_BOT_TOKEN")
    telegram_chat_id: str = Field("", env="TELEGRAM_CHAT_ID")

    # 시트 이름 (고정값)
    sheet_order: str = "주문확인(원본)"
    sheet_blank: str = "무지상품재고"
    sheet_transfer: str = "전사지재고"
    sheet_finished: str = "완제품재고"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
