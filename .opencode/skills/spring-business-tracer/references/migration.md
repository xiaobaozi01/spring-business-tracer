# V0.5/V1.0/V1.5 到 V2.0 迁移

迁移默认dry-run。`--apply`获取迁移锁，按来源保留V0.5/V1.0/V1.5配置，写PREPARED journal，再原子写V2配置，最后写APPLIED。崩溃可由备份和哈希恢复；重复执行NOOP；不一致备份或journal拒绝覆盖。

迁移只处理配置。所有旧run/snapshot原字节保持LEGACY_READ_ONLY/FULL_REBASE_REQUIRED，不能转换为V2增量baseline、跨版本diff或补造provenance；首次V2必须FULL_REBASE。
