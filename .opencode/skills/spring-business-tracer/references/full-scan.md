# V2.0 全项目扫描

## `/spring-scan`

参数：

```text
--new
--resume [runId]
--batch-size N
--max-agents N
--services service-a,service-b
```

默认行为：存在全部V2指纹一致的未完成run时恢复；否则创建FULL run。`--new`强制新建，增量使用`/spring-update`。

## 编排步骤与持久化阶段

1. Doctor步骤：检查工具、索引和全部指纹。
2. 配置步骤：冻结analysisContexts，config auditor独立提交CONFIG报告。
3. 发现步骤：服务归属、入口候选、Code Graph确认。
3. `PLANNED`：覆盖审计通过，冻结 inventory。
4. `TRACING`：按稳定 ID 排序领取隔离批次。
5. `VALIDATING`：每个 traced 单元由独立 validator 复查。
6. `PUBLISHING`：只发布 verified 单元到 staging。
7. 审计步骤：Validator直接提交覆盖与逻辑边界认证报告。
8. 建图并进入 `FINALIZING`，原子发布不可变快照与current指针。
9. `COMPLETE/PARTIAL/PAUSED/FAILED/STALE`。

## 批次隔离

- 一个入口是最小可提交单元；批次只是调度集合。
- Worker 得到 entry ID、service root、profile、指纹和查询预算，不得到其他 worker 的推理。
- 主 Agent 顺序提交状态，防止多个 worker 覆盖同一 manifest。
- claim和close、RESUME、PARTIAL、COMPLETE校验源码四指纹、resolutionContextHash和adapterRegistryFingerprint。
- commit 必须传回 claim 返回的单元 `fingerprintToken`。
- TRACE、VALIDATE、PUBLISH是三个独立租约阶段；每批heartbeat并在所有单元提交后close。
- 超过 retryLimit 为 `BLOCKED/FAILED`，不能无限循环。

## 资源边界

达到当前上下文/时间预算时：

1. 不再领取新批次；
2. 完成已领取的最小单元或让租约过期；
3. 请求 pause，输出 runId、状态计数、未完成列表和恢复命令；
4. 不把“本轮完成”描述为“全项目完成”。

## 聚合发布

发布顺序：入口文档 → 服务/表/边界文档 → manifest → index/run summary。聚合文档只引用已发布入口。任何验证失败都保留原始工件和错误码，但不进入正式 PASS 汇总。
