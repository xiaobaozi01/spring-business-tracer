#!/usr/bin/env python3
"""Spring Business Tracer V1.5 的确定性与真实 Code Graph 验收。"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / ".opencode/skills/spring-business-tracer"
V10_FIXTURE = ROOT / "tests/fixtures/v05-commerce-system"
V15_FIXTURE = ROOT / "tests/fixtures/v15-business-system"
COMMANDS = {"spring-doctor", "spring-trace", "spring-scan", "spring-update", "spring-migrate", "spring-pause", "spring-resume", "spring-status", "spring-query", "spring-impact", "spring-diff"}
SUBAGENTS = {"spring-entry-worker", "spring-trace-worker", "spring-trace-validator", "spring-coverage-auditor", "spring-boundary-validator", "spring-incremental-validator"}


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def read(path: Path) -> str:
    check(path.is_file(), f"缺少文件：{path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def run(command: list[str], cwd: Path = ROOT) -> str:
    completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    check(completed.returncode == 0, f"命令失败：{' '.join(command)}\n{completed.stderr or completed.stdout}")
    return completed.stdout


def validate_structure() -> list[str]:
    config = json.loads(read(ROOT / ".opencode/spring-business-tracer.json"))
    check(config["version"] == "1.5.0" and config["language"] == "java", "配置不是Java-only V1.5")
    check(set(config["entrypoints"]["verifiedAdapters"]) == {"SPRING_MVC", "SPRING_WEBFLUX", "KAFKA", "RABBIT", "SCHEDULED", "SPRING_EVENT", "APPLICATION_RUNNER"}, "verified adapter集合错误")
    check(config["crossService"]["kafka"]["consumerGroupSemantics"] is True, "Kafka group语义未启用")
    check(config["graph"] == {"diffEnabled": True, "pathQueryMaxDepth": 20, "pathQueryMaxResults": 100, "recordTombstones": True}, "图配置错误")
    skill = read(SKILL / "SKILL.md")
    check("version: 1.5.0" in skill and len(skill.splitlines()) < 500, "Skill版本或长度错误")
    schemas = {p.stem.removesuffix(".schema") for p in (SKILL / "schemas").glob("*.schema.json")}
    check(len(schemas) == 12 and "graph-diff" in schemas, "V1.5 schema集合错误")
    check({p.stem for p in (ROOT / ".opencode/commands").glob("*.md")} == COMMANDS, "命令集合错误")
    check({p.stem for p in (ROOT / ".opencode/agents").glob("*.md")} == SUBAGENTS | {"spring-business-orchestrator"}, "Agent集合错误")
    for name in COMMANDS:
        check("agent: spring-business-orchestrator" in read(ROOT / f".opencode/commands/{name}.md"), f"{name}未绑定主Agent")
    run(["node", "tests/scripts/validate_schemas.mjs"])
    return ["Java-only V1.5、1主6子Agent、11命令、12 Schema与能力分层闭合"]


def validate_plugin() -> list[str]:
    text = read(ROOT / ".opencode/plugins/spring-business-state.js")
    for token in ("TOMBSTONES_ACCOUNTED", "manifestHash", "writePublicationBundle", "diffGraphSnapshots", "findSnapshotPaths", "MAX_PATH_VISITS", "COMPETING_ONE_OF", "semanticKey"):
        check(token in text, f"插件缺少：{token}")
    for forbidden in ("tree-sitter", "javaparser", "eclipse.jdt", "cypher"):
        check(forbidden not in text.lower(), f"插件疑似实现第二代码图：{forbidden}")
    check(text.count("export default SpringBusinessStatePlugin") == 1 and not re.search(r"^export\s+(?:async|const|function)", text, re.MULTILINE), "插件只能default导出")
    run(["node", "--check", ".opencode/plugins/spring-business-state.js"])
    run(["node", "tests/scripts/test_state_plugin_v15.mjs"])
    return ["动态状态测试覆盖manifest/index、tombstone、稳定边ID、STRICT_ENTRY path、diff、迁移与篡改拒绝"]


def validate_codegraph_contract(fixture: Path, contract_name: str, required: bool) -> tuple[int, int]:
    contract = json.loads(read(fixture / contract_name))
    binary = shutil.which("codegraph")
    if not binary:
        check(not required, "要求真实CodeGraph但未安装")
        return (0, 0)
    status = json.loads(run([binary, "status", ".", "-j"], fixture))
    check(status["initialized"] and status["index"]["state"] == "complete", f"CodeGraph索引不完整：{fixture.name}")
    check(not any(status["pendingChanges"].values()) and status["worktreeMismatch"] is None, f"CodeGraph索引漂移：{fixture.name}")
    symbols = contract["symbols"]
    cache: dict[str, list[dict]] = {}
    edges = contract["javaEdges"] + [[e["from"], e["to"]] if isinstance(e, dict) else e for e in contract.get("codeGraphSpecialEdges", [])]
    for left, right in edges:
        source = symbols[left]["qname"]
        if source not in cache:
            result = json.loads(run([binary, "callees", source, "-p", ".", "-l", "101", "-j"], fixture))
            cache[source] = result.get("callees", [])
            check(len(cache[source]) < 101, f"CodeGraph查询触顶：{source}")
        target = symbols[right]
        check(any(row.get("filePath") == target["file"] and row.get("startLine") == target["line"] for row in cache[source]), f"真实CodeGraph缺边：{left}->{right}")
    return (len(contract["javaEdges"]), len(contract.get("codeGraphSpecialEdges", [])))


def validate_v15_fixture(required: bool) -> list[str]:
    contract = json.loads(read(V15_FIXTURE / "codegraph-contract.json"))
    check(len(contract["entries"]) == 6 and {e["adapter"] for e in contract["entries"]} == {"SPRING_MVC", "SPRING_WEBFLUX", "KAFKA", "APPLICATION_RUNNER"}, "V1.5入口契约错误")
    kafka = [b for b in contract["logicalBoundaries"] if b["kind"] == "KAFKA"]
    check(len(kafka) == 2 and any(b["deliverySemantics"] == "COMPETING_ONE_OF" and len(b["targets"]) == 2 for b in kafka), "Kafka竞争消费契约错误")
    check({b["kind"] for b in contract["logicalBoundaries"]} == {"REST_TEMPLATE_HTTP", "WEBCLIENT_HTTP", "KAFKA"}, "V1.5边界类型错误")
    check({p["adapter"] for p in contract["persistenceAccesses"]} == {"JPA", "MYBATIS_ANNOTATION", "JDBC_TEMPLATE"}, "持久化adapter契约错误")
    check(all(p["resource"].startswith("db:") for p in contract["persistenceAccesses"]), "数据资源未包含storeId")
    check({x["case"] for x in contract["unresolvedBoundaries"]} == {"dynamic-url-parameter", "dynamic-topic-parameter"}, "动态边界负例缺失")
    check(contract["dynamicPersistenceCases"][0]["classification"] == "DYNAMIC_TABLE", "动态表名负例缺失")
    normal, special = validate_codegraph_contract(V15_FIXTURE, "codegraph-contract.json", required)
    binary = shutil.which("codegraph")
    if binary:
        routes = json.loads(run([binary, "query", "", "-p", ".", "-k", "route", "-l", "101", "-j"], V15_FIXTURE))
        check(len(routes) == 2 and {Path(r["node"]["filePath"]).name for r in routes} == {"CheckoutController.java", "CatalogController.java"}, "MVC/WebFlux route入口或HTTP client排除错误")
    return [f"V1.5真实夹具：6入口、{normal}条Java边、{special}条接口特殊边、Kafka group竞争语义和3类持久化通过"]


def validate_v10_regression(required: bool) -> list[str]:
    normal, special = validate_codegraph_contract(V10_FIXTURE, "codegraph-contract.json", required)
    check((normal, special) == (20, 3), "V1.0真实CodeGraph回归边数变化")
    return ["V1.0四服务真实CodeGraph 20条Java边和3条特殊边无退化"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-codegraph", action="store_true")
    args = parser.parse_args()
    try:
        checks = validate_structure() + validate_plugin() + validate_v15_fixture(args.require_codegraph) + validate_v10_regression(args.require_codegraph)
    except (AssertionError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    for item in checks:
        print(f"PASS: {item}")
    print(f"\nV1.5确定性验收通过：{len(checks)}项")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
