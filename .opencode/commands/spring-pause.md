---
description: 请求Spring全项目分析在当前最小入口单元完成后安全暂停
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer` 和 `references/state-machine.md`。对 run `$ARGUMENTS` 调用 `spring_state_control` 的 `PAUSE`。不要强行中断正在执行的 Code Graph 查询；停止领取新批次，等待当前最小单元提交或租约过期，然后报告 `PAUSE_REQUESTED/PAUSED`。
