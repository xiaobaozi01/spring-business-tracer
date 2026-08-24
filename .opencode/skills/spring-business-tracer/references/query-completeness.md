# V2.0 Code Graph 查询完整性

Code Graph CLI/MCP 的 query、callees、callers 可能有默认条数限制。每次调用必须显式传 `limit=maxBranches+1`（默认101），并在 `queryLog` 保存工具、完整参数、目的、`resultCount`和`truncated`。

以下任一情况禁止写“完整”：缺少 limit/resultCount；limit不是配置值；工具声明 truncated；resultCount达到 limit；索引 status 不是 complete；存在 pendingChanges/worktreeMismatch/reindexRecommended；查询超时或符号歧义。处理方式是扩大有界预算后重查，仍不完整则入口或整次运行 PARTIAL。

覆盖审计还要检查所有 enabled adapter，包括零命中 adapter；Feign route 等出站客户端进入 `excludedCandidates`，不得作为 Controller 入口。
