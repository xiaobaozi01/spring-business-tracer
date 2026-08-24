#!/usr/bin/env python3
"""顺序编译V1.5沿用的Java回归夹具及V1.0/V1.5综合项目。"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = (
    "mybatis-order-service",
    "jpa-account-service",
    "jdbc-inventory-service",
    "v05-commerce-system",
    "v15-business-system",
    "v20-enterprise-system",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--maven", help="mvn可执行文件的绝对路径；默认从PATH查找")
    parser.add_argument("--local-repo", help="可选的Maven本地仓库目录")
    parser.add_argument("--timeout", type=int, default=300, help="每个夹具的超时秒数，默认300")
    args = parser.parse_args()

    maven = args.maven or shutil.which("mvn")
    if not maven:
        print("FAIL: 未找到mvn；请安装Maven或通过--maven指定路径", file=sys.stderr)
        return 2

    for fixture in FIXTURES:
        command = [maven, "-q", "-f", str(ROOT / "tests/fixtures" / fixture / "pom.xml")]
        if args.local_repo:
            command.append(f"-Dmaven.repo.local={Path(args.local_repo).resolve()}")
        command.append("test")
        print(f"RUN: {fixture}", flush=True)
        try:
            completed = subprocess.run(command, cwd=ROOT, check=False, timeout=args.timeout)
        except subprocess.TimeoutExpired:
            print(f"FAIL: {fixture} Maven测试超过{args.timeout}秒", file=sys.stderr)
            return 124
        if completed.returncode != 0:
            print(f"FAIL: {fixture} Maven测试失败", file=sys.stderr)
            return completed.returncode
        print(f"PASS: {fixture} Maven测试通过")

    print(f"\nSpring示例项目均编译通过：{len(FIXTURES)}项（含V1.0、V1.5与V2.0综合项目）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
