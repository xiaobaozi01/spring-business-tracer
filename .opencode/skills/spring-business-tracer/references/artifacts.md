# 文档约定

只使用 Markdown。主 Agent 使用宿主的写入/编辑工具维护以下文件，不通过 shell、脚本或临时程序生成。

- `docs/spring-business/workspace.md`：工作区范围与 context。
- `docs/spring-business/current.md`：最近一次正式发布的 run 链接、范围及状态。
- `docs/spring-business/runs/<runId>/plan.md`：进度与恢复点。
- 同一 run 下 `inventory/<service>.md`：该服务入口清单及覆盖复核。
- `drafts/<entrySlug>.md`：未完成或未复核的笔记。
- `entries/<entrySlug>.md`：带独立复核结果的交付。
- `index.md`、`topology.md`、`tables.md`：本次范围的汇总与反向导航。

runId 使用时间加简短主题；文件名仅字母数字和短横线，冲突加后缀。逻辑入口键写在内容中，以“服务 + 触发器 + 完整签名”识别入口；不要把 URL、FQCN 或未经检查的参数直接拼成路径，不要创建指向目录外的链接。

## plan 内容

任务目标、范围、context、工具包版本、Git revision/dirty状态、索引身份/新鲜度、基线、已知外部缺口；入口进度表包含稳定入口键、草稿/结果链接、状态、下一步。状态用待分析、分析中、待复核、已复核、PARTIAL。最后记录下次从哪里继续。

## 入口笔记

使用 [入口模板](../assets/entry.md)。至少包含业务目的、触发器与符号、逐跳路径、条件与事务、副作用、数据库访问、跨服务关系、依赖范围、未知项和逐项证据。

每条证据有本笔记内唯一ID、类型、源码文件/行号、Code Graph实际工具与查询目标、观察到的事实。只保存支撑结论的必要片段；查询摘要省略了什么必须记录。跨笔记引用用相对文件路径加证据ID，不能依赖聊天消息。

复核者返回 PASS/REVISE/PARTIAL 和问题位置；主 Agent 原样保存主要结论和依据，不能把 REVISE 改成 PASS。PARTIAL 可以作为明确不完整的交付，未知关系不进入“已确认”的拓扑表。

## 汇总与查询依据

index 列出范围、每个入口状态和链接。tables 按数据源/表/操作列出入口和持久化符号。topology 使用节点表与关系表：节点类型包括服务、入口、Java符号、HTTP端点、消息通道、订阅、RPC、任务、GraphQL操作、数据资源；关系区分Java直接调用、框架分派、HTTP/MQ/RPC/Event逻辑关系和数据访问。

每条关系记录源/目标ID、context、入口归属、条件、证据链接和复核状态；节点ID保持语义稳定，不含行号。查询以这些表和原始笔记为准，Mermaid 只是辅助展示。一个服务过大时拆成服务页并在根表链接，查询只读相关页，再按证据追溯。

路径默认只能沿同一个入口的已确认关系展开；显式 COMPOSED 允许跨入口拼接时必须标“潜在静态可达”。Kafka同group竞争消费者也不能描述为一次消息必定到达全部listener。

旧版 current.json/snapshots 可作为历史只读文档参考；不得复活其租约、认证哈希或把旧报告当本次新复核。
