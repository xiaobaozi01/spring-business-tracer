# V2.0 发布事务与恢复

PUBLISH 阶段只允许读取 `docs/spring-business/.staging/<runId>/` 下的普通文件，插件计算实际文档哈希。全部 PUBLISHED/REUSED、认证coverage/boundary报告通过且图实际字节哈希验证后，run先进入FINALIZING并落盘意图，再将 staging 原子rename为 `snapshots/<runId>`，最后原子更新 `current.json`。

崩溃后 `spring_state_recover` 可幂等完成rename或current指针更新。已存在快照必须先验证graphHash，不覆盖不一致快照。旧快照不可变；新run永远发布到新runId。
