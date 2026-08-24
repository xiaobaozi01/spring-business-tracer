---
description: 预览或原子迁移V0.5/V1.0/V1.5配置到V2.0，保留备份且不迁移旧分析结论
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer` 和 `references/migration.md`。参数：`$ARGUMENTS`。

默认调用`spring_migrate_config` dry-run；只有明确`--apply`才迁移。旧run保持LEGACY_READ_ONLY，首次V2执行FULL_REBASE，不补造provenance。
