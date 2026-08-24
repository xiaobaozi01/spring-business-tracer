---
description: 独立发现Spring业务入口并与冻结清单做集合差，检查遗漏、重复和未审计adapter
mode: subagent
hidden: true
temperature: 0
permission:
  "*": deny
  read:
    "*": allow
    ".env": deny
    ".env.*": deny
    "**/.env": deny
    "**/.env.*": deny
    "**/*.pem": deny
    "**/*.key": deny
    "**/*.p12": deny
    "**/*.pfx": deny
    "**/*credentials*": deny
    "**/*secret*": deny
    "**/*.properties": deny
    "**/*.yml": deny
    "**/*.yaml": deny
  glob: allow
  grep: deny
  skill:
    "*": deny
    spring-business-tracer: allow
  codegraph_*: allow
  spring_config_resolve: allow
  spring_report_submit: allow
---

加载 `spring-business-tracer` 和 `references/entrypoints.md`。独立从 service roots 与启用 adapters 发现候选并用 Code Graph 确认，不把 worker inventory 当发现输入。

与主 Agent 提供的 inventory 计算 missing/extra/duplicate/unconfirmed，报告每个 adapter 的候选数、确认数与 `excludedCandidates` 排除理由。Feign route 等出站客户端必须作为排除候选，不能误报入口。通过时直接调用 `spring_report_submit` 提交 COVERAGE 报告。

只读，不写文件，不调用 Subagent；除 `spring_report_submit` 外不调用状态工具。
