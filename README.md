# Spring Business Tracer

**纯 Markdown 的 OpenCode Agent + Skill 工具包。没有自定义 tools、插件、运行时、脚本、Schema 或 npm 依赖。**

基于用户已有的 Code Graph，梳理 Java Spring 从业务入口到 Service、跨服务边界和数据库的链路。使用 OpenCode 原生 Task、读取、搜索、文档编辑工具；进度、证据和结果都写在 Markdown 中。

## 安装

将本仓库以下目录中的 Markdown 文件复制到目标 Java 项目的同名目录，然后重启 OpenCode：

- `.opencode/agents/`
- `.opencode/commands/`
- `.opencode/skills/spring-business-tracer/`
- `.opencode/skills/spring-analysis/`
- `.opencode/skills/spring-review/`
- `.opencode/skills/spring-query/`

无需为本工具包安装依赖。OpenCode启动时可能自行生成它的SDK依赖文件，这些已被gitignore排除，不属于工具包发行内容。Code Graph 由用户提前安装并索引；工具包不会自动初始化或刷新索引。

先运行 `/spring-doctor scan`，再运行 `/spring-scan --new`。首次使用会根据项目结构建立 `docs/spring-business/workspace.md`，记录服务、共享模块、分析范围及 profile，不要求填写一大份配置文件。

## 分工

| Agent | 职责 | Skill |
|---|---|---|
| spring-business-orchestrator | 管理范围、任务交接、Markdown进度和交付；唯一文档写入者 | spring-business-tracer、spring-query |
| spring-analyst | 发现入口、追踪调用、解释业务条件、关联边界和数据访问 | spring-analysis |
| spring-reviewer | 独立重新取得证据，复核结果、入口覆盖和复用依据 | spring-review |

正常流程是 **入口清单 → 分析笔记 → 独立复核 → 中文交付**。不再设置多阶段租约、心跳、认证对象或自建状态机。

## 命令

| 命令 | 功能 |
|---|---|
| `/spring-doctor [trace\|scan\|cross-service\|impact\|resume]` | 检查实际 Code Graph 能力、索引和范围 |
| `/spring-trace http:POST:/api/orders` | 追踪指定入口；也接受完整Java签名或入口ID |
| `/spring-scan --new` | 全量发现所选范围内的入口并逐个分析 |
| `/spring-update --base current` | 根据Git变更和笔记中的依赖范围增量重查 |
| `/spring-pause runId` | 保存当前笔记与下一步后暂停 |
| `/spring-resume runId` | 从Markdown进度恢复，先检查版本与工作树变化 |
| `/spring-status runId` | 查看已保存的进度和缺口 |
| `/spring-query table:inventory.stock_item` | 查询已有文档；显式 `--live` 查询当前Code Graph |
| `/spring-impact method:com.acme.OrderService#create` | 沿真实callers追查静态影响范围 |
| `/spring-diff oldRun newRun` | 比较两次入口、关系、证据和范围变化 |
| `/spring-context resolve prod` | 解释本地profile、相关配置来源和placeholder |
| `/spring-topology neighbors service:order-service` | 查询文档中的服务、协议和数据拓扑 |
| `/spring-explain entry:order-create` | 追溯一个结论为什么成立 |

保留 Spring MVC/WebFlux、消息监听、定时任务、Event、Runner、GraphQL/RPC 入口，Feign/HTTP/MQ/RPC 跨服务关系，以及 JPA、MyBatis、JdbcTemplate 等持久化分析方法。动态和无法验证的部分明确保留为 PARTIAL。

## 结果

结果保存在 `docs/spring-business/runs/<runId>/`：plan、入口清单、草稿、带复核意见的入口文档、拓扑表和数据库汇总。`current.md` 链接最近正式发布的结果。详细目录见 [文档约定](.opencode/skills/spring-business-tracer/references/artifacts.md)。

Java调用边仍以Code Graph为依据，文本匹配不能替代调用证据。复核是独立Agent的证据复查；恢复是读取工作记录，增量是保守判断依赖。没有旧引擎的哈希认证、原子发布、并发写入隔离或自动分片查询保证。同一run由一个主会话写入；变化无法确定时重新分析。

## 升级旧版

在已安装的副本中移除本工具包的 `spring-business-state.js`、`plugins/spring-business/`、七个旧worker/validator/auditor Agent，以及旧的 spring-business-tracer Skill，然后复制上述目录。旧 `.opencode` 中其他工具包的插件、配置和依赖不要一起删除。

旧JSON配置中的服务/context可转记为workspace.md。旧缓存和快照保留作历史参考，新版不恢复旧租约或认证协议。不要复制 `.cache`、node_modules、测试构建产物或 `*-workspace` 历史工作目录。

设计参考与取舍见 [设计说明](docs/agent-skill-design.md)，行为验收场景见 [验收说明](tests/README.md)。
