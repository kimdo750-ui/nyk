#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
뉴욕꼬맹이 전사지 자동 검색 & 열기 (CSV 버전)
Google Sheets를 CSV로 내보낸 후 사용합니다.

1. Google Sheets에서 "전사지출력목록" 시트를 CSV로 내보내기
2. 이 스크립트 폴더에 transfer_list.csv 로 저장
3. 스크립트 실행
"""

import os
import sys
import subprocess
import csv
from pathlib import Path
from typing import List, Set


class TransferFileFinder:
    def __init__(self, csv_file: str, transfer_folder: str, file_ext: str = ".ai"):
        """
        Args:
            csv_file: CSV 파일 경로 (Google Sheets 내보내기)
            transfer_folder: 전사지 파일 폴더 (예: E:\\뉴욕꼬맹이)
            file_ext: 파일 확장자 (예: .ai)
        """
        self.csv_file = Path(csv_file)
        self.transfer_folder = Path(transfer_folder)
        self.file_ext = file_ext.lower()

        if not self.csv_file.exists():
            raise FileNotFoundError(f"❌ CSV 파일을 찾을 수 없습니다: {csv_file}\n\n"
                                   f"📌 방법:\n"
                                   f"1. Google Sheets 열기\n"
                                   f"2. '전사지출력목록' 시트 우클릭\n"
                                   f"3. '다운로드' → 'CSV 형식'\n"
                                   f"4. {self.csv_file} 로 저장")

        if not self.transfer_folder.exists():
            raise FileNotFoundError(f"❌ 폴더를 찾을 수 없습니다: {transfer_folder}")

    def get_print_needed_codes(self) -> Set[str]:
        """
        CSV 파일에서 부족수량 > 0인 코드들 추출
        """
        try:
            needed_codes = set()

            with open(self.csv_file, 'r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)

                if not reader.fieldnames:
                    print("❌ CSV 파일이 비어있습니다")
                    return set()

                print(f"📋 CSV 읽는 중... ({self.csv_file.name})")
                print(f"헤더: {reader.fieldnames}")

                # '전사지코드', '부족수량' 열 확인
                required_cols = ['전사지코드', '부족수량']
                missing = [c for c in required_cols if c not in reader.fieldnames]

                if missing:
                    print(f"❌ 필수 열이 없습니다: {missing}")
                    print(f"사용 가능한 열: {reader.fieldnames}")
                    return set()

                # 데이터 읽기
                for row in reader:
                    code = row['전사지코드'].strip()
                    try:
                        needs = int(row['부족수량'])
                        if needs > 0 and code:
                            needed_codes.add(code)
                            print(f"  🔴 {code}: {needs}개 필요")
                    except (ValueError, KeyError):
                        pass

            print(f"\n📍 총 {len(needed_codes)}개 파일 검색\n")
            return needed_codes

        except Exception as e:
            print(f"❌ CSV 읽기 실패: {e}")
            raise

    def find_files(self, codes: Set[str]) -> dict:
        """로컬 폴더에서 파일 검색"""
        found = []
        not_found = []

        for code in sorted(codes):
            patterns = [
                f"{code}{self.file_ext}",
                f"{code.strip()}{self.file_ext}",
                f"{code.replace(' ', '')}{self.file_ext}",
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
                    os.startfile(filepath)
                elif sys.platform == 'darwin':
                    subprocess.Popen(['open', filepath])
                else:
                    subprocess.Popen(['xdg-open', filepath])
                print(f"  ✅ 열림: {Path(filepath).name}")
            except Exception as e:
                print(f"  ❌ 열기 실패 {Path(filepath).name}: {e}")

    def run(self):
        """전체 프로세스 실행"""
        print("=" * 60)
        print("🔍 뉴욕꼬맹이 전사지 자동 검색")
        print("=" * 60 + "\n")

        # 1. CSV에서 인쇄 필요 항목 추출
        codes = self.get_print_needed_codes()
        if not codes:
            print("📌 인쇄 필요한 항목이 없습니다")
            return

        # 2. 파일 검색
        results = self.find_files(codes)

        # 3. 파일 열기
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
    CSV_FILE = "transfer_list.csv"  # Google Sheets에서 내보낸 CSV 파일
    TRANSFER_FOLDER = r"E:\뉴욕꼬맹이"
    FILE_EXT = ".ai"

    try:
        finder = TransferFileFinder(CSV_FILE, TRANSFER_FOLDER, FILE_EXT)
        finder.run()
    except Exception as e:
        print(f"\n❌ 오류: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
