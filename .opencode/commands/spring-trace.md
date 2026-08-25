---
description: 使用Code Graph追踪一个Spring Java入口，跨服务到数据库并经独立Subagent验证
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer`，分析唯一目标：

```text
$ARGUMENTS
```

接受 `http:METHOD:/path`、`method:FQCN#method(params)` 或 `entry:id`。先执行 trace/cross-service Doctor，再调用 trace worker并用结构化`traceResult`提交；逻辑边界需要两侧证据和 boundary validator；最后调用 trace validator，Validator先读`spring_report_context`再提交结构化`report`。只有ACCEPTED验证才写正式入口文档。

契约回放测试按任务指定目录输出并标记 `TEST_ONLY`。
