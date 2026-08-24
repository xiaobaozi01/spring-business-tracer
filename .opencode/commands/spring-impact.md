---
description: 使用Code Graph caller或blast-radius分析方法、入口、表或跨服务边界的静态影响范围
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer` 和 `references/query-impact.md`。目标：`$ARGUMENTS`。

先执行 impact Doctor；caller/blast-radius能力缺失即 `FAIL`。Java反向边来自 Code Graph，跨服务传播只经过 VERIFIED logical boundary。输出受影响入口、服务、表、路径、查询记录和停止传播点，明确“静态可达不等于运行时必然执行”。
