# V2.0 配置说明

配置文件固定为 `.opencode/spring-business-tracer.json`。Doctor 每次读取并校验，不能因为缓存存在而跳过。

## 固定安全字段

以下值不可修改：

```json
{
  "version": "2.0.0",
  "language": "java",
  "output": {"directory": "docs/spring-business"},
  "resume": {"stateDirectory": ".opencode/.cache/spring-business-tracer/runs"},
  "codeGraph": {
    "allowNativeCallGraphFallback": false,
    "allowTextSearchCallGraphFallback": false
  }
}
```

固定字段不符时返回 `FAIL`，避免权限范围和实际写入位置分离。

## 服务源码根

单服务项目保持：

```json
{"workspace": {"services": [], "sharedModules": [], "autoDiscoverSingleService": true}}
```

多服务项目显式配置：

```json
{
  "workspace": {
    "services": [
      {"id": "order-service", "root": "services/order", "codeGraphProjectPath": "services/order", "packages": ["com.acme.order"], "aliases": ["order"]},
      {"id": "inventory-service", "root": "services/inventory", "codeGraphProjectPath": "services/inventory", "packages": ["com.acme.inventory"], "aliases": ["inventory"]}
    ],
    "sharedModules": [
      {"id": "business-common", "root": "modules/business-common", "codeGraphProjectPath": ".", "packages": ["com.acme.common"], "aliases": ["common"]}
    ],
    "requireAllServiceRootsIndexed": true
  }
}
```

约束：

- 可部署Spring应用只放`services`；common、SDK、生成DAO等不会独立接收入站流量的源码放`sharedModules`。两类id全局唯一。
- `root/codeGraphProjectPath`使用相对工作区路径；monorepo共用一个Code Graph索引时projectPath可统一为`.`。
- 所有 root 必须可读、包含 Java 源码并属于当前 Code Graph 索引。
- root 越出工作区、重叠且无法消歧、或存在未索引服务时，cross-service Doctor 返回 `FAIL`。
- `packages` 可帮助归属服务，但不能创建方法调用边。

## 可调参数

- `analysis.maxDepth`：单分支最大深度，达到后为 `PARTIAL`。
- `analysis.maxBranches`：单入口最大分支数，达到后为 `PARTIAL`。
- `codeGraph.queryLimit`：必须严格等于`analysis.maxBranches+1`，不一致时配置加载直接失败。
- `batching.batchSize`：每批入口数，范围 1–100。
- `batching.maxConcurrentSubagents`：建议 1–4，默认 3。
- `batching.leaseSeconds`：租约 30–3600 秒。
- `batching.discoveryLeaseSeconds`：单服务入口发现租约30–3600秒，超时后只回收该服务。
- `batching.heartbeatSeconds`：OPEN批次续租周期。
- `batching.retryLimit`：同一单元最大重试次数。
- `entrypoints.enabledAdapters`：只启用明确列出的入口适配器。
- `entrypoints.customAnnotations`：自定义入口注解；候选仍需 Code Graph 确认。

`crossService.requireTwoSidedEvidence` 和 `verification.publishOnlyVerified` 必须保持 `true`。关闭它们会让 Doctor 返回 `FAIL`。

## 指纹

每个 run 保存：

- `configHash`：规范化配置的哈希；
- `sourceSnapshot`：纳入范围源码和配置的实际字节哈希；另保存逐服务`serviceSnapshots`与逐共享模块`sharedModuleSnapshots`；
- `indexFingerprint`：Code Graph版本与每个projectPath完整status的组合哈希；
- `toolkitFingerprint`：Skill、references、agents、commands和插件实际字节哈希。

Resume 四项必须完全一致。索引必须complete、无pending/worktreeMismatch/reindexRecommended，否则新run也拒绝分析。
