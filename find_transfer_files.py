#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
뉴욕꼬맹이 전사지 자동 검색 & 열기
Google Sheets의 전사지출력목록에서 인쇄 필요한 항목을 읽고
로컬 폴더에서 해당 파일을 찾아 자동으로 엽니다.
"""

import os
import sys
import subprocess
from pathlib import Path
from typing import List, Set

# Google Sheets API
try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    print("❌ 필수 라이브러리 없음. 설치 명령어:")
    print("   pip install gspread google-auth-oauthlib google-auth-httplib2 google-api-python-client")
    sys.exit(1)


class TransferFileFinder:
    def __init__(self, sheet_url: str, transfer_folder: str, file_ext: str = ".ai"):
        """
        Args:
            sheet_url: Google Sheets URL
            transfer_folder: 전사지 파일 폴더 (예: D:\\전사지)
            file_ext: 파일 확장자 (예: .ai, .pdf)
        """
        self.sheet_url = sheet_url
        self.transfer_folder = Path(transfer_folder)
        self.file_ext = file_ext.lower()

        if not self.transfer_folder.exists():
            raise FileNotFoundError(f"❌ 폴더를 찾을 수 없습니다: {transfer_folder}")

        self.gc = None
        self.sheet = None

    def authenticate(self, credentials_json: str = None):
        """Google Sheets 인증"""
        try:
            if credentials_json and os.path.exists(credentials_json):
                # 서비스 계정 키 사용
                creds = Credentials.from_service_account_file(
                    credentials_json,
                    scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
                )
                self.gc = gspread.authorize(creds)
                print("✅ 서비스 계정 인증 성공")
            else:
                # OAuth2 사용 (첫 실행 시 브라우저 열림)
                self.gc = gspread.oauth(
                    scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
                )
                print("✅ OAuth2 인증 성공")
        except Exception as e:
            print(f"❌ 인증 실패: {e}")
            raise

    def open_sheet(self):
        """Google Sheets 오픈"""
        try:
            self.sheet = self.gc.open_by_url(self.sheet_url)
            print(f"✅ 시트 열기 성공: {self.sheet.title}")
        except Exception as e:
            print(f"❌ 시트 열기 실패: {e}")
            print(f"   URL이 올바른지, 공유 권한이 있는지 확인하세요")
            raise

    def get_print_needed_codes(self) -> Set[str]:
        """
        '전사지출력목록' 시트에서 부족수량 > 0인 코드들 추출
        """
        try:
            # 워크시트 찾기
            worksheets = {ws.title: ws for ws in self.sheet.worksheets()}

            if '전사지출력목록' not in worksheets:
                print(f"❌ '전사지출력목록' 시트를 찾을 수 없습니다")
                print(f"   사용 가능한 시트: {list(worksheets.keys())}")
                return set()

            ws = worksheets['전사지출력목록']
            print(f"\n📋 '{ws.title}' 시트 읽는 중...")

            # 데이터 읽기 (헤더: A=전사지코드, B=필요잉크, C=주문수량, D=현재재고, E=부족수량, F=상태)
            data = ws.get_all_values()

            if len(data) < 2:
                print("❌ 시트에 데이터가 없습니다")
                return set()

            # 헤더 확인
            header = data[0]
            print(f"헤더: {header}")

            # 부족수량 열 찾기 (E열)
            try:
                code_idx = header.index('전사지코드')
                needs_idx = header.index('부족수량')
            except ValueError:
                print("❌ 필수 열을 찾을 수 없습니다 (전사지코드, 부족수량)")
                return set()

            # 부족수량 > 0인 코드 추출
            needed_codes = set()
            for row in data[1:]:
                if len(row) > max(code_idx, needs_idx):
                    code = row[code_idx].strip()
                    try:
                        needs = int(row[needs_idx])
                        if needs > 0 and code:
                            needed_codes.add(code)
                            print(f"  🔴 {code}: {needs}개 필요")
                    except ValueError:
                        pass

            print(f"\n📍 총 {len(needed_codes)}개 파일 검색")
            return needed_codes

        except Exception as e:
            print(f"❌ 데이터 읽기 실패: {e}")
            raise

    def find_files(self, codes: Set[str]) -> dict:
        """
        로컬 폴더에서 파일 검색

        Returns:
            {'found': [경로들], 'not_found': [코드들]}
        """
        found = []
        not_found = []

        for code in sorted(codes):
            # 파일명 변형 (공백 제거, 다양한 형식 고려)
            patterns = [
                f"{code}{self.file_ext}",
                f"{code.strip()}{self.file_ext}",
                f"{code.replace(' ', '')}{self.file_ext}",
                f"{code.replace(' ', '_')}{self.file_ext}",
            ]

            found_file = None
            for pattern in patterns:
                matching = list(self.transfer_folder.glob(pattern))
                if matching:
                    found_file = matching[0]
                    break

            # 파일 대소문자 무시 검색
            if not found_file:
                for file in self.transfer_folder.glob(f"*{self.file_ext}"):
                    if file.stem.upper() == code.upper():
                        found_file = file
                        break

            if found_file:
                found.append(str(found_file))
                print(f"  ✅ {code}: {found_file.name}")
            else:
                not_found.append(code)
                print(f"  ❌ {code}: 파일 없음")

        return {'found': found, 'not_found': not_found}

    def open_files(self, file_paths: List[str]):
        """파일들을 기본 프로그램으로 자동 열기"""
        if not file_paths:
            print("열 파일이 없습니다")
            return

        print(f"\n📂 {len(file_paths)}개 파일 열기...")

        for filepath in file_paths:
            try:
                if sys.platform == 'win32':
                    # Windows
                    os.startfile(filepath)
                elif sys.platform == 'darwin':
                    # macOS
                    subprocess.Popen(['open', filepath])
                else:
                    # Linux
                    subprocess.Popen(['xdg-open', filepath])
                print(f"  ✅ 열림: {Path(filepath).name}")
            except Exception as e:
                print(f"  ❌ 열기 실패 {Path(filepath).name}: {e}")

    def run(self, credentials_json: str = None):
        """전체 프로세스 실행"""
        print("=" * 60)
        print("🔍 뉴욕꼬맹이 전사지 자동 검색")
        print("=" * 60)

        # 1. 인증
        self.authenticate(credentials_json)

        # 2. 시트 열기
        self.open_sheet()

        # 3. 인쇄 필요 항목 추출
        codes = self.get_print_needed_codes()
        if not codes:
            print("📌 인쇄 필요한 항목이 없습니다")
            return

        # 4. 파일 검색
        results = self.find_files(codes)

        # 5. 파일 열기
        if results['found']:
            self.open_files(results['found'])

        # 결과 요약
        print("\n" + "=" * 60)
        print(f"✅ 완료: {len(results['found'])}개 파일 열음")
        if results['not_found']:
            print(f"⚠️  찾지 못한 파일: {', '.join(results['not_found'])}")
        print("=" * 60)


def main():
    # ⚙️ 설정 (여기서 수정)
    SHEET_URL = "https://docs.google.com/spreadsheets/d/1IJdRZQn3tAUsGcyHFMq-LaABTUyJauqtWKkmTXPeYwM/edit"  # 실제 URL로 변경
    TRANSFER_FOLDER = r"E:\뉴욕꼬맹이"
    FILE_EXT = ".ai"
    CREDENTIALS_JSON = None  # 또는 "credentials.json" (서비스 계정 키)

    # 입력값 확인
    if "YOUR_SHEET_ID" in SHEET_URL:
        print("❌ SHEET_URL을 설정하세요")
        print("   코드의 SHEET_URL = '...' 부분을 수정하고 다시 실행하세요")
        return

    try:
        finder = TransferFileFinder(SHEET_URL, TRANSFER_FOLDER, FILE_EXT)
        finder.run(CREDENTIALS_JSON)
    except Exception as e:
        print(f"\n❌ 오류: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
