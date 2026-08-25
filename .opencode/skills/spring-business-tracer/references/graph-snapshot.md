# V2.0 可查询图快照

图源仅是本 run 已 PUBLISHED 的实际 trace 工件与 REUSED 入口在 baseline 中的实际 trace 工件。按规范 JSON 排序去重，生成 `graph/meta.json`、`nodes.jsonl`、`edges.jsonl`。

边类型只有 JAVA_CALL、CODEGRAPH_SPECIAL、LOGICAL_BOUNDARY、PERSISTENCE。JAVA_CALL/CODEGRAPH_SPECIAL必须绑定本次运行queryLog中的`codegraph_*`工具与相同limit，JAVA_CALL还保留源码位置；LOGICAL_BOUNDARY只接受VERIFIED；PERSISTENCE保留表、CRUD和原始证据。graphHash覆盖meta（去掉graphHash字段）、nodes与edges的实际字节。

edge `id` 是不含行号与入口归属的稳定语义身份；`evidenceHash` 和 `entryMembership` 独立变化。相同事实被多个入口命中时只输出一条 edge 并合并 membership。

查询支持 node、entry、table、boundary、service、neighbors(in/out/both) 与 path。path 只在可信快照做有界迭代 BFS，不新增 Java 事实；默认 `STRICT_ENTRY`，整条路径必须共享至少一个 entryMembership。`COMPOSED` 允许拼接但必须标 `potential=true`；路径经过 `COMPETING_ONE_OF` 时无论模式均标 potential 并返回原因。限制 maxDepth≤20、maxPaths≤100、访问边≤100000，环路使用 simple path。

`spring_graph_diff`只比较两个同版V2 COMPLETE快照，分类ADDED、REMOVED、CHANGED_EVIDENCE、CHANGED_MEMBERSHIP；内部用完整change-set构建graphDelta和tombstone，对外只返回有界rows、counts、total和truncated/complete。任一快照哈希/计数/端点不一致即拒绝。禁止跨major语义diff。

正式 snapshot 还包含由插件生成的 `manifest.json` 与 `index.md`。它们和每个入口文档按实际字节存 hash，FINALIZING 恢复时全部重验。

V2拓扑meta/分片和证据图JSONL读取前逐级拒绝symlink目录、symlink/多硬链文件和超限文件，以no-follow文件描述符读取并在读后复验设备、inode、大小和时间。写入使用同目录独占临时文件、fsync和原子rename，不在目标路径上先truncate。这是工作区资源/路径安全边界，仍不是外部签名。
