---
description: 列出、解析或解释V2 Spring profile与placeholder分析上下文，不读取环境变量和秘密文件
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer` 与 `references/config-resolution.md`。参数：`$ARGUMENTS`，支持 `list`、`resolve [contextId]`、`explain contextId:key`。调用 `spring_config_resolve`，只输出非敏感值、valueHash、origin和未解析原因；敏感键禁止输出原值。外部配置、SpEL、循环、缺失或多义值明确标 PARTIAL。
