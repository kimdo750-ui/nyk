#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""테스트용 이미지 생성"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# 테스트 파일명 (엑셀의 전사지코드)
test_files = ["ASS001", "ASS002", "G056", "G057", "G059", "G061"]

folder = Path(r"E:\뉴욕꼬맹이")

print("🎨 테스트 이미지 생성 중...\n")

for filename in test_files:
    filepath = folder / f"{filename}.jpg"

    # 실제 JPEG 이미지 생성
    img = Image.new('RGB', (400, 200), color=(100, 150, 200))  # 파란색 배경
    draw = ImageDraw.Draw(img)

    # 텍스트 추가
    try:
        # 한글 폰트가 없으면 기본 폰트 사용
        draw.text((50, 80), f"TEST: {filename}", fill=(255, 255, 255))
    except:
        draw.text((50, 80), f"TEST: {filename}", fill=(255, 255, 255))

    # JPEG로 저장
    img.save(filepath, 'JPEG')
    print(f"✅ 생성: {filename}.jpg")

print(f"\n📂 테스트 파일 생성 완료!")
print(f"위치: {folder}")
