#!/usr/bin/env python3
"""
オープンデータCSVから大阪府（都道府県コード: 27）のデータのみを抽出するスクリプト

特徴:
- 標準ライブラリのみで動作（pandasなどの追加インストール不要）
- 巨大なCSV（数十万行〜）でもメモリを消費しないストリーミング処理
- 厚労省医療情報ネット（G-MIS / ナビイ）などのオープンデータ仕様に完全対応:
  1. 「都道府県コード」列が "27"
  2. 「所在地」「住所」列が "大阪府" で始まる/含む
  3. 「都道府県」列が "大阪府"
  4. 「ID」列が "27" で始まる（医療機関コード・施設ID体系）
- UTF-8 (BOMあり/なし) および Shift_JIS (CP932) の自動判定に対応
- 出力はExcelで文字化けしない UTF-8 (BOM付き)
"""

from __future__ import annotations

import argparse
import csv
import glob
import os
import sys
from pathlib import Path

OSAKA_CODE = "27"
OSAKA_NAME = "大阪府"

# 候補となるエンコーディング
CANDIDATE_ENCODINGS = ["utf-8-sig", "cp932", "utf-8", "euc-jp"]


def detect_encoding(file_path: Path) -> str:
    """ファイルのエンコーディングを自動検出する"""
    for enc in CANDIDATE_ENCODINGS:
        try:
            with open(file_path, "r", encoding=enc) as f:
                # 最初の数万バイトを読み込んで検証
                f.read(65536)
            return enc
        except (UnicodeDecodeError, UnicodeError):
            continue
    return "utf-8-sig"


def is_osaka_row(row: dict, fieldnames: list[str]) -> bool:
    """1行のデータが大阪府のものかどうかを判定する"""
    # 1. 都道府県コード列の判定
    for col in ["都道府県コード", "都道府県CD", "pref_code", "prefecture_code"]:
        if col in row and row[col]:
            val = row[col].strip().zfill(2)
            if val == OSAKA_CODE:
                return True

    # 2. 都道府県列の判定
    for col in ["都道府県", "都道府県名", "pref_name", "prefecture"]:
        if col in row and row[col]:
            val = row[col].strip()
            if OSAKA_NAME in val or val == "大阪":
                return True

    # 3. 所在地・住所列の判定
    for col in ["所在地", "住所", "所在地住所", "address"]:
        if col in row and row[col]:
            val = row[col].strip()
            if val.startswith(OSAKA_NAME) or f" {OSAKA_NAME}" in val or f"　{OSAKA_NAME}" in val:
                return True

    # 4. ID列（厚労省オープンデータ: 先頭2桁が都道府県コード）
    for col in ["ID", "id", "機関ID", "医療機関ID", "施設ID"]:
        if col in row and row[col]:
            val = row[col].strip()
            if val.startswith(OSAKA_CODE):
                return True

    # 5. 列名が見つからない場合、先頭列のID判定
    if fieldnames:
        first_col = fieldnames[0]
        val = (row.get(first_col) or "").strip()
        if val.startswith(OSAKA_CODE) and len(val) >= 10:
            return True

    return False


def extract_osaka_from_csv(
    input_path: Path,
    output_path: Path,
    encoding: str | None = None,
    output_encoding: str = "utf-8-sig",
) -> int:
    """CSVから大阪府の行を抽出して書き出す"""
    src_enc = encoding or detect_encoding(input_path)
    print(f"\n[処理開始] {input_path} (入力文字コード: {src_enc})")

    extracted_count = 0
    total_count = 0

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(input_path, "r", encoding=src_enc, errors="replace") as fin:
        reader = csv.DictReader(fin)
        fieldnames = reader.fieldnames

        if not fieldnames:
            print(f"  警告: ヘッダーが見つかりませんでした: {input_path}")
            return 0

        with open(
            output_path, "w", encoding=output_encoding, newline=""
        ) as fout:
            writer = csv.DictWriter(fout, fieldnames=fieldnames)
            writer.writeheader()

            for row in reader:
                total_count += 1
                if is_osaka_row(row, fieldnames):
                    writer.writerow(row)
                    extracted_count += 1

    print(f"  総件数: {total_count:,} 件")
    print(f"  抽出件数（大阪府）: {extracted_count:,} 件")
    print(f"  出力先: {output_path}")

    return extracted_count


def find_default_csvs() -> list[Path]:
    """カレントディレクトリから対象のオープンデータCSVを検索"""
    patterns = [
        "01-1_*.csv",
        "01-2_*.csv",
        "04_*.csv",
        "*hospital*.csv",
        "*maternity*.csv",
    ]
    found = set()
    for pat in patterns:
        for p in glob.glob(pat):
            # 抽出後の出力ファイルやバックアップ等は除外
            if not p.startswith("osaka_") and not p.startswith("extracted_"):
                found.add(Path(p))
    return sorted(list(found))


def main():
    parser = argparse.ArgumentParser(
        description="オープンデータCSVから大阪府のデータのみを抽出するスクリプト"
    )
    parser.add_argument(
        "inputs",
        nargs="*",
        type=Path,
        help="対象のCSVファイルパス（省略時はカレントディレクトリのオープンデータCSVを自動検索）",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="出力ファイルパスまたは出力先ディレクトリ（単一ファイル処理時のみ有効）",
    )
    parser.add_argument(
        "-d",
        "--output-dir",
        type=Path,
        default=Path("osaka_extracted"),
        help="複数ファイル処理時の出力ディレクトリ (デフォルト: osaka_extracted/)",
    )
    parser.add_argument(
        "--encoding",
        type=str,
        default=None,
        help="入力ファイルのエンコーディング（未指定時は自動検出: utf-8-sig, cp932等）",
    )

    args = parser.parse_args()

    # 入力ファイルの決定
    input_files: list[Path] = args.inputs
    if not input_files:
        input_files = find_default_csvs()
        if not input_files:
            # 汎用的に *.csv を探す
            input_files = [
                p
                for p in sorted(Path(".").glob("*.csv"))
                if not p.name.startswith("osaka_")
                and not p.name.startswith("extracted_")
            ]

    if not input_files:
        print("エラー: 処理対象のCSVファイルが見つかりませんでした。")
        print("使用例: python extract_osaka.py <CSVファイル名>")
        sys.exit(1)

    print(f"=== 大阪府データ抽出スクリプト ===")
    print(f"対象ファイル数: {len(input_files)}")

    # 単一ファイルで -o が指定されている場合
    if len(input_files) == 1 and args.output:
        out_path = args.output
        if out_path.is_dir() or str(out_path).endswith("/") or str(out_path).endswith("\\"):
            out_path = out_path / f"osaka_{input_files[0].name}"
        extract_osaka_from_csv(input_files[0], out_path, encoding=args.encoding)
    else:
        # 複数ファイル、または -o 未指定時
        out_dir = args.output_dir
        for target in input_files:
            out_file = out_dir / f"osaka_{target.name}"
            extract_osaka_from_csv(target, out_file, encoding=args.encoding)

    print("\nすべての抽出処理が完了しました！")


if __name__ == "__main__":
    main()
