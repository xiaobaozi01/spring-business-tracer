---
description: 一键按一个或多个Spring分析上下文解析整个Java项目，分批验证并发布V2类型化拓扑
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer`，读取 `references/full-scan.md`、`entrypoints.md`、`state-machine.md`、`validation.md`。

执行完整扫描：Doctor→spring_config_resolve→config auditor提交CONFIG报告→全服务入口发现→冻结inventory→分批trace/验证/发布→coverage/boundary→V2分片拓扑→COMPLETE。批次定期heartbeat并close，认证报告由对应Validator直接提交。

参数：`$ARGUMENTS`。支持 `--new`、`--resume [runId]`、`--batch-size N`、`--max-agents N`、`--services ids`、`--contexts ids`。这是FULL_REBASE；增量使用`/spring-update`。
