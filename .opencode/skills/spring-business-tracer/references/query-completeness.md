# V2.0 Code Graph 查询完整性

配置加载时插件强制`codeGraph.queryLimit=analysis.maxBranches+1`（默认101）。每次查询必须显式传该`limit`，并在`queryLog`保存工具、完整参数、目的、`resultCount`、`truncated`、`completionStatus=EXPLICIT_COMPLETE`与`summaryOmittedCount=0`。

以下任一情况禁止写“完整”：工具schema缺少limit/resultCount/truncated；只有`maxFiles`；limit不是配置值；工具声明truncated；resultCount达到limit；摘要含`and N more`或任何省略项；索引status不是complete；存在pendingChanges/worktreeMismatch/reindexRecommended；查询超时或符号歧义。Doctor对此FAIL，分析阶段则PARTIAL/FAILED，不能补造字段。

覆盖审计还要检查所有 enabled adapter，包括零命中 adapter；Feign route 等出站客户端进入 `excludedCandidates`，不得作为 Controller 入口。
