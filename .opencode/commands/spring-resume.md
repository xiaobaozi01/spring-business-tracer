---
description: 校验配置、源码和Code Graph索引指纹后继续暂停或中断的全项目分析
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer`、`references/state-machine.md` 和 `references/full-scan.md`。目标 run：`$ARGUMENTS`。

先调用 `spring_state_recover` 恢复过期租约、未关闭批次或 FINALIZING 发布事务，再执行 resume Doctor并计算四类指纹。完全一致才调用 `spring_state_control RESUME`。指纹不一致时保持 `STALE`，禁止静默复用旧结论。
