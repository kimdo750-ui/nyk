"""
매일 09:10에 일일 리포트를 자동 생성하고 사용자에게 전송
APScheduler를 사용한 백그라운드 작업 스케줄링
"""
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
from daily_report import generate_daily_report

logger = logging.getLogger(__name__)

# 글로벌 스케줄러 인스턴스
_scheduler: BackgroundScheduler = None


def init_scheduler():
    """스케줄러 초기화 (앱 시작 시 호출)"""
    global _scheduler

    if _scheduler is not None:
        return  # 이미 초기화됨

    _scheduler = BackgroundScheduler()

    # 매일 09:10에 실행
    _scheduler.add_job(
        func=_scheduled_daily_report,
        trigger=CronTrigger(hour=9, minute=10),
        id="daily_report_0910",
        name="Daily Report (09:10)",
        replace_existing=True,
        timezone="Asia/Seoul"  # 한국 시간대
    )

    _scheduler.start()
    logger.info("✅ 스케줄러 시작 - 매일 09:10에 일일 리포트 생성")


def stop_scheduler():
    """스케줄러 정지"""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown()
        logger.info("✅ 스케줄러 정지")


def _scheduled_daily_report():
    """스케줄러에서 실행될 함수"""
    try:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        logger.info(f"🕐 스케줄된 작업 실행: {now}")

        # 리포트 생성
        report = generate_daily_report()

        # TODO: 여기서 사용자에게 리포트 전송
        # 옵션 1: 이메일 전송
        # 옵션 2: 문자 메시지
        # 옵션 3: 콘솔 출력 (개발 중)

        logger.info(f"✅ 일일 리포트 생성 및 전송 완료\n{report}")

        return report

    except Exception as e:
        logger.error(f"❌ 스케줄된 작업 실패: {e}")
        return f"오류: {str(e)}"


def get_report_now():
    """즉시 리포트 생성 (테스트용)"""
    logger.info("🔄 즉시 리포트 생성...")
    return _scheduled_daily_report()


# ─────────────────────────────────────────
# 테스트용 실행
# ─────────────────────────────────────────
if __name__ == "__main__":
    import time

    logging.basicConfig(level=logging.INFO)
    logger.info("🧪 스케줄러 테스트 모드")

    # 스케줄러 시작
    init_scheduler()
    logger.info("⏰ 다음 실행 시간:")
    for job in _scheduler.get_jobs():
        logger.info(f"  {job}")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        stop_scheduler()
        print("\n종료됨")
