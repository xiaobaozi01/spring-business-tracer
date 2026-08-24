#!/usr/bin/env python3
"""为V0.5三类Agent报告生成skill-creator兼容grading.json。"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def has(text: str, values: list[str]) -> tuple[bool, str]:
    missing = [value for value in values if value.lower() not in text.lower()]
    return not missing, "完整" if not missing else "缺少：" + "、".join(missing)


def one(title: str, passed: bool, evidence: str) -> dict:
    return {"text": title, "passed": passed, "evidence": evidence}


def full_scan(report: str) -> list[dict]:
    items = []
    passed = "TEST_ONLY" in report and any(word in report for word in ("不能替代", "不得替代", "不替代"))
    items.append(one("报告明确标记TEST_ONLY，并声明契约回放不能替代正式Code Graph在线分析", passed, "TEST_ONLY与回放限制"))
    tokens = ["POST /api/orders", "GET /internal/customers/{id}/active", "POST /internal/inventory/reserve", "order.created", "0 */5 * * * *", "OrderCreatedEvent"]
    passed, evidence = has(report, tokens)
    items.append(one("完整列出6个入口，覆盖HTTP、Rabbit、Scheduled和Spring Event", passed, evidence))
    java_relation = "Java边" in report or "Java 调用边" in report or "CODEGRAPH_JAVA_EDGE" in report
    passed = all(value in report for value in ("20", "3", "4", "LOGICAL_BOUNDARY")) and java_relation and ("特殊" in report or "映射" in report)
    items.append(one("区分20条Java调用边、3条Code Graph特殊映射/分派边与4条VERIFIED LOGICAL_BOUNDARY", passed, "边计数与关系类型"))
    tables = ["sales.t_order", "sales.order_audit", "crm.customer_account", "inventory.stock_item", "inventory.stock_reservation", "notify.delivery_log"]
    passed, evidence = has(report, tables + ["INSERT", "READ", "UPDATE", "DELETE"])
    items.append(one("只列出契约中的6张表及准确CRUD，并能说明跨服务链路到customer、inventory和notification", passed, evidence))
    agents = ["spring-entry-worker", "spring-trace-worker", "spring-trace-validator", "spring-coverage-auditor", "spring-boundary-validator"]
    passed, evidence = has(report, agents + ["PUBLISHED", "coverage", "boundary", "COMPLETE"])
    items.append(one("说明5个Subagent的独立职责，以及全部PUBLISHED、coverage/boundary审计后才能COMPLETE", passed, evidence))
    return items


def resume_state(report: str) -> list[dict]:
    specs = [
        ("准确给出PENDING到PUBLISHED的单元状态链和PAUSE_REQUESTED/PAUSED行为", ["PENDING", "LEASED", "TRACED", "VERIFIED", "PUBLISHED", "PAUSE_REQUESTED", "PAUSED"]),
        ("说明leaseOwner、leaseUntil、attempts及过期租约回收，不允许非持有者提交TRACED", ["leaseOwner", "leaseUntil", "attempts", "过期", "TRACED"]),
        ("恢复必须同时匹配configHash、sourceSnapshot和indexFingerprint，任一变化进入STALE", ["configHash", "sourceSnapshot", "indexFingerprint", "STALE"]),
        ("说明checkpoint使用临时文件、fsync和原子rename，并且只在最小入口单元边界停批", ["临时", "fsync", "rename", "最小", "入口"]),
        ("说明claim返回fingerprintToken、commit内部重算三指纹并校验令牌；所有单元PUBLISHED且两份结构化coverageAuditJson和boundaryAuditJson均ACCEPTED才能COMPLETE", ["fingerprintToken", "内部", "PUBLISHED", "coverageAuditJson", "boundaryAuditJson", "ACCEPTED", "COMPLETE"]),
    ]
    items = []
    for title, tokens in specs:
        passed, evidence = has(report, tokens)
        if "非持有者" in title:
            passed = passed and any(word in report for word in ("拒绝", "不能", "不允许"))
        items.append(one(title, passed, evidence))
    return items


def impact(report: str) -> list[dict]:
    items = []
    specs = [
        ("报告明确标记TEST_ONLY并要求正式运行在线查询Code Graph caller/impact能力", ["TEST_ONLY", "Code Graph", "caller"]),
        ("decreaseStock的直接反向路径为InventoryMapper.decreaseStock到InventoryService.reserve再到InventoryInternalController.reserve", ["InventoryMapper.decreaseStock", "InventoryService.reserve", "InventoryInternalController.reserve"]),
        ("经过VERIFIED FEIGN_HTTP逻辑边界后，影响扩展到CheckoutService.create和POST /api/orders入口", ["FEIGN_HTTP", "CheckoutService.create", "POST /api/orders"]),
        ("inventory.stock_item的受影响入口准确包含order HTTP、inventory HTTP和ReservationExpiryJob定时任务", ["POST /api/orders", "POST /internal/inventory/reserve", "ReservationExpiryJob"]),
    ]
    for title, tokens in specs:
        passed, evidence = has(report, tokens)
        items.append(one(title, passed, evidence))
    java_relation = "Java边" in report or "Java 调用边" in report or "Java caller" in report
    static_limit = ("静态" in report and "运行时" in report and any(term in report for term in ("不等于", "并不意味着", "不代表")))
    passed = java_relation and ("逻辑边界" in report or "LOGICAL_BOUNDARY" in report) and static_limit
    items.append(one("区分Code Graph Java边与逻辑边界，并声明静态可达不等于运行时必然执行", passed, "关系类型与静态限制"))
    return items


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--eval-name", choices=["full-scan", "resume-state", "cross-service-impact"], required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    args = parser.parse_args()
    report = (args.run_dir / "outputs/report.md").read_text(encoding="utf-8")
    grader = {"full-scan": full_scan, "resume-state": resume_state, "cross-service-impact": impact}[args.eval_name]
    expectations = grader(report)
    passed = sum(item["passed"] for item in expectations)
    grading = {
        "expectations": expectations,
        "summary": {"passed": passed, "failed": len(expectations) - passed, "total": len(expectations), "pass_rate": passed / len(expectations)},
        "execution_metrics": {"tool_calls": {}, "total_tool_calls": 0, "total_steps": 0, "errors_encountered": 0, "output_chars": len(report), "transcript_chars": 0},
        "claims": [], "user_notes_summary": {"uncertainties": [], "needs_review": [], "workarounds": []}
    }
    (args.run_dir / "grading.json").write_text(json.dumps(grading, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(grading["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
