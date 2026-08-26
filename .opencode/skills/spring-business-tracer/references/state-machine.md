# V2.0 状态机、批次与恢复

## Run 状态

状态插件持久化的阶段是：

```text
CREATED -> PLANNED -> TRACING -> VALIDATING -> PUBLISHING -> FINALIZING -> COMPLETE
活动态 -> PAUSE_REQUESTED -> PAUSED -> 原活动态
指纹不符 -> STALE；不可恢复错误 -> FAILED；有已发布结果和未交付缺口 -> PARTIAL
```

Doctor、入口发现和最终审计是编排步骤，不伪装成持久化 phase；主 Agent 在事件/summary 中记录它们。`COMPLETE/PARTIAL/FAILED/STALE` 都是终态。

## Unit 状态

```text
PENDING -> LEASED(TRACE) -> TRACED -> LEASED(VALIDATE) -> VERIFIED -> LEASED(PUBLISH) -> PUBLISHED
基线安全复用 -> REUSED
任一LEASED阶段 -> RETRYABLE_FAILED(保留retryStage) -> LEASED(原阶段)
活动态 -> BLOCKED | FAILED | STALE
```

Worker 只能产生 trace 工件；对应 Validator 必须直接提交认证报告，主 Agent 再用 reportId 提交 `VERIFIED`。

## 租约

- 领取时记录 `leaseOwner/leaseUntil/attempts`，响应同时返回插件进程的`serverNow/heartbeatDueAt`；Agent不要用自身时区换算截止时间。
- 过期租约只在recover或下一次claim时回收为`RETRYABLE_FAILED`，错误码 `LEASE_EXPIRED`；若 attempts 已超过 retryLimit 则直接 `FAILED/RETRY_LIMIT_EXCEEDED`。
- 提交与续租以owner、batch和不可伪造fencing token为准。即使wall-clock截止时间刚过，只要租约尚未被回收/重领，迟到结果仍可安全提交并返回`lateCommitAccepted=true`；一旦重领，旧token永久拒绝。
- TRACE、VALIDATE、PUBLISH分别重新领取；发现租约和批次租约都支持heartbeat，真实续租必须使用新的operationId。
- `retryLimit` 在状态插件层强制；耗尽后单元进入 `FAILED`，不能再次领取。
- 一个 run 同时只允许一个 OPEN batch；批次定期 heartbeat，所有租约结束后 close。
- pause 不打断正在执行的工具；在批次关闭边界停止领取。

租约签发、续租、过期观察均由同一个插件进程使用`Date.now()`完成，ISO时间统一为UTC。因此Agent模型时间和时区不会造成持续超时；系统时钟大幅跳变、设备休眠或没有按`heartbeatDueAt`续租才可能造成过期。`spring_discovery_status`和各租约响应中的`serverNow/remainingSeconds/expiredBySeconds`用于定位这类问题。

## Resume

Resume 必须重新 Doctor 并比较：

```text
configHash == checkpoint.configHash
sourceSnapshot == checkpoint.sourceSnapshot
indexFingerprint == checkpoint.indexFingerprint
toolkitFingerprint == checkpoint.toolkitFingerprint
```

任一不等就写 `STALE` 并拒绝继续。四项一致时：

- 回收过期租约；
- 保留已提交阶段的实际 artifact/document hash；
- 从 `PENDING/RETRYABLE_FAILED` 继续；
- 不重复发布相同 document hash。

活动run也可能遇到并发变化。公开初始化必须显式提供`runId + operationId`；claim、commit、report、close、RESUME、seed、建图、PARTIAL、COMPLETE均由插件重算V2指纹；commit绑定claim令牌。每个run状态写操作带operationId，幂等摘要包含操作类型；只有完全相同的重试返回原结果，参数或操作改变时必须换新ID。

`PAUSED` 不能直接重新规划入口；终态 run 不能再提交单元、恢复或重新完成。需要重规划时创建新 run。

## 完成检查

状态工具检查所有单元是否 `PUBLISHED/REUSED`、不存在OPEN batch、coverage/boundary认证报告通过、文档实际字节哈希匹配且确定性图快照存在。插件使用OpenCode调用上下文限制只有指定Validator/Auditor能提交对应报告。FINALIZING采用可恢复的快照rename与current指针更新事务。
