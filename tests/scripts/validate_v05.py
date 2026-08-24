#!/usr/bin/env python3
"""Spring Business Tracer V0.5 的独立、确定性验收。"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / ".opencode/skills/spring-business-tracer"
FIXTURE = ROOT / "tests/fixtures/v05-commerce-system"
SUBAGENTS = {
    "spring-entry-worker",
    "spring-trace-worker",
    "spring-trace-validator",
    "spring-coverage-auditor",
    "spring-boundary-validator",
}
COMMANDS = {
    "spring-doctor", "spring-trace", "spring-scan", "spring-pause",
    "spring-resume", "spring-status", "spring-query", "spring-impact",
}


class ValidationError(AssertionError):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def read(path: Path) -> str:
    check(path.is_file(), f"缺少文件：{path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path):
    try:
        return json.loads(read(path))
    except json.JSONDecodeError as exc:
        raise ValidationError(f"JSON格式错误：{path.relative_to(ROOT)}: {exc}") from exc


def source_evidence(item: dict) -> None:
    path = FIXTURE / item["file"]
    lines = read(path).splitlines()
    line = item["line"]
    check(1 <= line <= len(lines), f"证据行越界：{item['file']}:{line}")
    if "contains" in item:
        check(item["contains"] in lines[line - 1], f"证据内容不匹配：{item['file']}:{line}")
    else:
        check(bool(lines[line - 1].strip()), f"证据不能指向空行：{item['file']}:{line}")


def reachable(edges: list[list[str]], source: str, target: str) -> bool:
    graph: dict[str, list[str]] = defaultdict(list)
    for left, right in edges:
        graph[left].append(right)
    queue = deque([source])
    visited = set()
    while queue:
        node = queue.popleft()
        if node == target:
            return True
        if node in visited:
            continue
        visited.add(node)
        queue.extend(graph[node])
    return False


def validate_structure() -> list[str]:
    required = [
        ROOT / "README.md",
        ROOT / ".opencode/package.json",
        ROOT / ".opencode/package-lock.json",
        ROOT / ".opencode/spring-business-tracer.json",
        ROOT / ".opencode/plugins/spring-business-state.js",
        SKILL / "SKILL.md",
    ]
    references = {
        "configuration", "codegraph-contract", "entrypoints", "trace-workflow",
        "persistence", "full-scan", "state-machine", "cross-service",
        "validation", "query-impact", "output-format", "contract-replay",
    }
    schemas = {"config", "run", "entry-inventory", "trace-result", "verification", "boundary-link", "manifest", "audit"}
    required += [SKILL / f"references/{name}.md" for name in references]
    required += [SKILL / f"schemas/{name}.schema.json" for name in schemas]
    required += [ROOT / f".opencode/commands/{name}.md" for name in COMMANDS]
    required += [ROOT / ".opencode/agents/spring-business-orchestrator.md"]
    required += [ROOT / f".opencode/agents/{name}.md" for name in SUBAGENTS]
    for path in required:
        read(path)

    skill_text = read(SKILL / "SKILL.md")
    check("version: 0.5.0" in skill_text and len(skill_text.splitlines()) < 500, "Skill版本或长度错误")
    for name in references:
        check(f"references/{name}.md" in skill_text, f"Skill未路由reference：{name}")
    check("Java 调用边只能来自 Code Graph" in skill_text or "Java调用边只能来自Code Graph" in skill_text, "缺少Code Graph唯一事实源约束")
    check("caller" in skill_text and "LOGICAL_BOUNDARY" in skill_text, "缺少影响或逻辑边界约束")

    package = load_json(ROOT / ".opencode/package.json")
    check(package.get("type") == "module", "状态插件包必须声明ES module")
    check(package.get("dependencies", {}).get("@opencode-ai/plugin") == "1.16.0", "OpenCode插件依赖未锁定")
    check(package.get("devDependencies", {}).get("ajv") == "8.18.0", "Ajv Schema校验依赖未锁定")
    config = load_json(ROOT / ".opencode/spring-business-tracer.json")
    check(config["version"] == "0.5.0" and config["language"] == "java", "配置必须是V0.5 Java-only")
    check(config["output"]["directory"] == "docs/spring-business", "正式输出目录错误")
    check(config["resume"]["stateDirectory"] == ".opencode/.cache/spring-business-tracer/runs", "状态目录错误")
    check(config["codeGraph"]["allowNativeCallGraphFallback"] is False, "禁止本地调用图回退")
    check(config["codeGraph"]["allowTextSearchCallGraphFallback"] is False, "禁止文本调用图回退")
    check(config["crossService"]["requireTwoSidedEvidence"] is True, "跨服务必须双侧证据")
    check(config["verification"]["publishOnlyVerified"] is True, "禁止发布未验证单元")
    check(not (ROOT / ".opencode/tools").exists(), "不得实现第二套Java分析工具")
    skill_files = list((ROOT / ".opencode/skills").glob("**/SKILL.md"))
    check(skill_files == [SKILL / "SKILL.md"], f"发现同名/嵌套Skill污染加载：{skill_files}")
    schema_check = subprocess.run(
        ["node", str(ROOT / "tests/scripts/validate_schemas.mjs")], cwd=ROOT,
        text=True, capture_output=True, check=False,
    )
    check(schema_check.returncode == 0, f"JSON Schema真实校验失败：{schema_check.stderr or schema_check.stdout}")
    return ["Skill、12份reference、8份schema、配置和依赖完整且通过Ajv正反例", "Java调用图回退与越界写入均被禁止"]


def validate_agents_and_commands() -> list[str]:
    agent_files = {path.stem for path in (ROOT / ".opencode/agents").glob("*.md")}
    check(agent_files == SUBAGENTS | {"spring-business-orchestrator"}, f"Agent数量/名称错误：{sorted(agent_files)}")
    primary = read(ROOT / ".opencode/agents/spring-business-orchestrator.md")
    check("mode: primary" in primary and '"*": deny' in primary, "主Agent模式或默认权限错误")
    check('"docs/spring-business/**": allow' in primary, "主Agent缺少受限文档写权限")
    check("spring_state_*: allow" in primary and "codegraph_*: allow" in primary, "主Agent缺少状态/CodeGraph权限")
    for agent in SUBAGENTS:
        text = read(ROOT / f".opencode/agents/{agent}.md")
        check("mode: subagent" in text and "hidden: true" in text, f"{agent}不是隐藏Subagent")
        check('"*": deny' in text and "codegraph_*: allow" in text, f"{agent}默认拒绝或CodeGraph权限错误")
        check('"**/.env": deny' in text and '"**/*.pem": deny' in text and '"**/*secret*": deny' in text, f"{agent}敏感文件读取规则缺失")
        check("edit:" not in text and "spring_state_" not in text and "task:" not in text, f"{agent}不应有写入、状态或递归委派权限")
    for agent in SUBAGENTS:
        check(f"    {agent}: allow" in primary, f"主Agent未白名单{agent}")
    command_files = {path.stem for path in (ROOT / ".opencode/commands").glob("*.md")}
    check(command_files == COMMANDS, f"命令集合错误：{sorted(command_files)}")
    for command in COMMANDS:
        text = read(ROOT / f".opencode/commands/{command}.md")
        check("agent: spring-business-orchestrator" in text and "subtask: false" in text, f"{command}绑定错误")
    return ["1个主Agent与5个只读Subagent权限闭合", "8个V0.5命令均绑定主Agent"]


def validate_state_plugin() -> list[str]:
    text = read(ROOT / ".opencode/plugins/spring-business-state.js")
    for tool_name in ("fingerprint", "init", "plan", "claim", "commit", "control", "status"):
        check(f"spring_state_{tool_name}" in text, f"缺少状态工具：{tool_name}")
    lower = text.lower()
    for forbidden in ("tree-sitter", "javaparser", "eclipse.jdt", "sqlite", "cypher"):
        check(forbidden not in lower, f"状态插件疑似实现代码图：{forbidden}")
    check("handle.sync()" in text and "rename(temporary, path)" in text, "checkpoint不是fsync+原子rename")
    check("recoverExpiredLeases" in text and "RESUME_FINGERPRINT_MISMATCH" in text, "缺少租约回收或恢复指纹门禁")
    check("coverageAuditJson" in text and "boundaryAuditJson" in text, "COMPLETE缺少结构化独立审计门禁")
    check("fingerprintToken: tool.schema.string()" in text and "verificationJson" in text, "commit缺少批次令牌或结构化验证报告")
    check("defaultCodeGraphVersion" in text and "fingerprint-cache.json" in text, "指纹缺少CodeGraph版本或增量源码缓存")
    completed = subprocess.run(
        ["node", str(ROOT / "tests/scripts/test_state_plugin.mjs")], cwd=ROOT,
        text=True, capture_output=True, check=False,
    )
    check(completed.returncode == 0, f"状态机动态测试失败：{completed.stderr or completed.stdout}")
    return ["状态插件仅管理checkpoint/租约/字节指纹且原子落盘", "状态机动态覆盖暂停、恢复、STALE、唯一租约令牌和结构化审计门禁"]


def validate_contract() -> list[str]:
    contract = load_json(FIXTURE / "codegraph-contract.json")
    check(contract["schemaVersion"] == "0.5" and contract["mode"] == "contract-replay", "V0.5契约头错误")
    check(contract["services"] == ["order-service", "customer-service", "inventory-service", "notification-service"], "必须覆盖4个服务")
    check(set(contract["capabilities"]) >= {"symbols", "locations", "callees", "callers", "impact"}, "契约能力不完整")
    entries = contract["entries"]
    check(len(entries) == 6 and {item["kind"] for item in entries} == {"HTTP", "RABBIT", "SCHEDULED", "SPRING_EVENT"}, "入口数量或类型错误")
    check(len({item["id"] for item in entries}) == 6, "入口ID不唯一")
    for item in entries:
        source_evidence(item)
    symbols = contract["symbols"]
    for symbol in symbols.values():
        source_evidence(symbol)
    edges = contract["javaEdges"]
    check(len(edges) == 20 and len({tuple(edge) for edge in edges}) == 20, "Java边数量/唯一性错误")
    check(all(left in symbols and right in symbols for left, right in edges), "Java边引用未知符号")
    for source, target in (("o1", "o5"), ("o10", "o11"), ("c1", "c3"), ("i1", "i5"), ("i6", "i10"), ("n1", "n3")):
        check(reachable(edges, source, target), f"预期Java路径不连通：{source}->{target}")
    special = contract["codeGraphSpecialEdges"]
    check(len(special) == 3 and {item["kind"] for item in special} == {"MYBATIS_XML_MAPPING", "FRAMEWORK_EVENT_DISPATCH"}, "Code Graph特殊边错误")
    check(all("不是Java调用边" in item.get("note", "") or item["kind"] == "FRAMEWORK_EVENT_DISPATCH" for item in special), "特殊边未区分Java调用")

    boundaries = contract["logicalBoundaries"]
    check(len(boundaries) == 4 and {item["kind"] for item in boundaries} == {"FEIGN_HTTP", "RABBIT", "SPRING_EVENT"}, "逻辑边界类型/数量错误")
    for boundary in boundaries:
        check(boundary["status"] == "VERIFIED", f"边界未验证：{boundary['id']}")
        check(boundary["source"] in symbols and boundary["target"] in symbols, f"边界符号未知：{boundary['id']}")
        source_evidence(boundary["sourceEvidence"])
        source_evidence(boundary["targetEvidence"])
        for evidence in boundary.get("additionalEvidence", []):
            source_evidence(evidence)
        check(all(key in boundary for key in ("key", "sourceService", "targetService")), f"边界规范字段缺失：{boundary['id']}")
    check(len({item["id"] for item in boundaries}) == 4, "边界ID重复")

    tables = {item["name"]: set(item["operations"]) for item in contract["tables"]}
    expected_tables = {
        "sales.t_order": {"INSERT"}, "sales.order_audit": {"INSERT"},
        "crm.customer_account": {"READ"}, "inventory.stock_item": {"READ", "UPDATE"},
        "inventory.stock_reservation": {"INSERT", "READ", "DELETE"},
        "notify.delivery_log": {"INSERT"},
    }
    check(tables == expected_tables, f"表/CRUD不一致：{tables}")
    for table in contract["tables"]:
        source_evidence(table)
        check(all(symbol in symbols for symbol in table["symbols"]), f"表引用未知符号：{table['name']}")

    impacts = contract["impactCases"]
    check(len(impacts) == 5 and all(item.get("requiresCallers", True) or item["target"].startswith("b-") for item in impacts), "影响用例不完整")
    stock = next(item for item in impacts if item["target"] == "inventory.stock_item")
    check(set(stock["expectedEntries"]) == {"o1", "i1", "i6"}, "表影响入口错误")
    return ["4服务、6入口、20条Java边、3条Code Graph特殊边和4条逻辑边界契约闭合", "6张表CRUD和5类正反向影响用例准确"]


def validate_fixture_build_model() -> list[str]:
    ns = {"m": "http://maven.apache.org/POM/4.0.0"}
    root = ET.parse(FIXTURE / "pom.xml").getroot()
    modules = [node.text for node in root.findall("m:modules/m:module", ns)]
    check(modules == ["order-service", "customer-service", "inventory-service", "notification-service"], "Maven模块错误")
    expected_dependencies = {
        "order-service": {"spring-boot-starter-web", "spring-boot-starter-amqp", "spring-cloud-starter-openfeign", "mybatis-spring-boot-starter"},
        "customer-service": {"spring-boot-starter-web", "spring-boot-starter-data-jpa"},
        "inventory-service": {"spring-boot-starter-web", "mybatis-spring-boot-starter"},
        "notification-service": {"spring-boot-starter-amqp", "mybatis-spring-boot-starter"},
    }
    for module, expected in expected_dependencies.items():
        pom = ET.parse(FIXTURE / module / "pom.xml").getroot()
        actual = {node.text for node in pom.findall("m:dependencies/m:dependency/m:artifactId", ns)}
        check(expected <= actual, f"{module}缺依赖：{sorted(expected - actual)}")
    missing = load_json(ROOT / "tests/fixtures/missing-codegraph/codegraph-contract.json")
    check(missing["expected"]["doctorStatus"] == "FAIL", "缺失CodeGraph能力必须失败关闭")
    return ["4模块Spring样例的构建模型与入口技术栈完整", "缺失CodeGraph能力的回归用例保持FAIL"]


def validate_real_codegraph(required: bool) -> list[str]:
    binary = shutil.which("codegraph")
    if not binary:
        check(not required, "--require-codegraph已启用但找不到codegraph")
        return ["未要求本机CodeGraph，已完成固定契约验证"]
    status = subprocess.run([binary, "status", "."], cwd=FIXTURE, text=True, capture_output=True, check=False)
    if status.returncode != 0:
        check(not required, f"CodeGraph夹具未初始化：{status.stderr or status.stdout}")
        return ["本机CodeGraph存在但夹具未初始化；固定契约仍通过"]
    check("Index is up to date" in status.stdout and "java" in status.stdout, "CodeGraph索引不是最新Java索引")
    contract = load_json(FIXTURE / "codegraph-contract.json")
    for probe in contract["realCodeGraphProbes"]:
        command = [binary, probe["command"], probe["symbol"], "-p", "."]
        if probe["command"] == "impact":
            command += ["-d", str(probe["depth"])]
        command.append("-j")
        completed = subprocess.run(command, cwd=FIXTURE, text=True, capture_output=True, check=False)
        check(completed.returncode == 0, f"CodeGraph探针失败：{' '.join(command)}")
        result = json.loads(completed.stdout)
        rows = result.get("callees") or result.get("callers") or result.get("affected") or []
        files = {row.get("filePath") for row in rows}
        check(set(probe["mustContainFiles"]) <= files, f"CodeGraph真实结果缺边：{probe['symbol']}")
    callee_cache: dict[str, list[dict]] = {}
    for left, right in contract["javaEdges"]:
        source_symbol = contract["symbols"][left]["qname"]
        if source_symbol not in callee_cache:
            command = [binary, "callees", source_symbol, "-p", ".", "-j"]
            completed = subprocess.run(command, cwd=FIXTURE, text=True, capture_output=True, check=False)
            check(completed.returncode == 0, f"CodeGraph逐边查询失败：{source_symbol}")
            callee_cache[source_symbol] = json.loads(completed.stdout).get("callees", [])
        target = contract["symbols"][right]
        check(
            any(row.get("filePath") == target["file"] and row.get("startLine") == target["line"] for row in callee_cache[source_symbol]),
            f"CodeGraph真实结果缺Java边：{left}->{right}",
        )
    return ["CodeGraph 1.5真实索引、4个caller/callee/impact探针及全部20条Java边通过"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-codegraph", action="store_true", help="要求本机CodeGraph已初始化并执行真实探针")
    args = parser.parse_args()
    checks: list[str] = []
    try:
        checks += validate_structure()
        checks += validate_agents_and_commands()
        checks += validate_state_plugin()
        checks += validate_contract()
        checks += validate_fixture_build_model()
        checks += validate_real_codegraph(args.require_codegraph)
    except (ValidationError, KeyError, OSError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    for item in checks:
        print(f"PASS: {item}")
    print(f"\nV0.5确定性验收通过：{len(checks)}项")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
