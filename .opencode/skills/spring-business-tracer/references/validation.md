# V2.0 独立验证

Code Graph 返回的 Mapper→XML 映射或框架事件分派要按特殊边记录，不能因“来自 Code Graph”就统一标成 Java 调用边。

## 原则

验证 Agent 不信任 Worker 的事实声明。它读取候选结果，但对关键结论重新执行最小 Code Graph 查询并核对源码证据。

## Trace validator

逐项检查：

- 入口符号唯一且指纹一致；
- 每条 Java 边有实际工具、参数、caller/callee身份、调用点；
- 接口实现来自 Code Graph；
- 从入口到每个持久化或边界终点连通；
- 表、CRUD、动态 SQL 和 JPA save 不确定性正确；
- 没有文本搜索创建的 Java 边；
- 所有查询显式limit且truncated=false，返回数未触顶；
- 事实、推断和未确认项分离。

常用错误码：

```text
ENTRY_NOT_UNIQUE
EDGE_WITHOUT_CODEGRAPH_EVIDENCE
EDGE_SOURCE_LOCATION_MISSING
IMPLEMENTATION_UNRESOLVED
TABLE_NOT_IN_SOURCE
CRUD_MISMATCH
DYNAMIC_SQL_OVERCLAIMED
INDEX_FINGERPRINT_MISMATCH
```

## Coverage auditor

独立发现入口并检查 `ENTRY_MISSING`、`ENTRY_EXTRA`、`ENTRY_DUPLICATE`、`ADAPTER_NOT_AUDITED`。它不能复用 worker 的候选集作为发现输入。

## Boundary validator

重新核对规范 key 与双方证据。报告必须输出精确 `verifiedBoundaryIds`；图构建只接受认证报告中的边界ID，Worker自行写 `status=VERIFIED` 不构成验证。常用错误码：

```text
BOUNDARY_SOURCE_MISSING
BOUNDARY_TARGET_MISSING
FEIGN_ROUTE_MISMATCH
MESSAGE_DESTINATION_MISMATCH
RPC_CONTRACT_MISMATCH
EVENT_TYPE_MISMATCH
BOUNDARY_AMBIGUOUS
```

## 增量 validator

独立核对同版V2 COMPLETE baseline、当前全量入口重发现、changedServices、changedConfigKeys、serviceClosure/configDependencyIds及闭合集合。

## Config auditor

独立调用确定性解析工具，核对profile优先级、placeholder解析、外部缺口和秘密脱敏，并提交绑定resolutionContextHash/contextIds的CONFIG报告。没有该报告不能COMPLETE。

## 判定

- 全部 validator PASS：`ACCEPTED`，Validator/Auditor直接调用 `spring_report_submit`。
- 任一 FAIL：`REJECTED`，不得发布。
- 证据不足但不是虚假边：`NEEDS_REVIEW/PARTIAL`，保留缺口，不发布为 PASS。

验证结果包含固定validator名称、独立查询或解析记录、错误码、必需checks、非空证据和全部V2指纹。TRACE报告还绑定当前VALIDATE租约令牌与实际traceHash。

独立性由 OpenCode 的Subagent身份、最小权限、重新查询和插件对 `context.agent` 的精确校验共同落实；主Agent没有报告提交权限。
