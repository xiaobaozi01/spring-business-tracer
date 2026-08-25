# V2.0 测试说明

测试覆盖五层：结构与最小权限、21份Schema正反例、逐服务入口checkpoint/状态机/分片篡改动态测试、真实Java构建、Code Graph真实索引合约。还覆盖结构化计数、有效Bean、receiver类型误边、共享模块与queryLimit等式。

## 一键验收

```bash
python3 tests/scripts/validate_v20.py --require-codegraph
python3 tests/scripts/compile_fixtures.py --maven /absolute/path/to/mvn --local-repo /tmp/m2
```

第一次真实Code Graph验证前，在综合夹具中由测试人员显式执行：

```bash
cd tests/fixtures/v20-enterprise-system
codegraph init .
```

工具包的 Doctor 和业务命令不会自动初始化、刷新或重建用户的 Code Graph 索引。

## 覆盖范围

- `validate_v20.py`：14个命令、1个主Agent+7个Subagent、21份Schema、V2真实合约及V1.0/V1.5回归。
- `validate_schemas.mjs`：Draft 2020-12全部合法样例，以及环境变量放宽、自定义脚本、配置依赖、伪造Code Graph工具和CONFIG审计缺根等负例。
- `test_state_plugin_v20.mjs`：22个插件工具、CodeGraph有界查询适配、逐服务发现租约/checkpoint、结构化计数、receiver类型误边、共享模块闭包、完整状态生命周期、类型化拓扑、增量删除/tombstone、安全路径与V1.5迁移。
- `v20-enterprise-system/codegraph-contract.json`：5个入口、11条Java边、4类框架分派、Gateway/JMS双侧逻辑边界、4个持久化反向探针和5个有真实源码的负能力Profile。
- `compile_fixtures.py`：3个早期回归项目、V1.0四服务、V1.5三服务与V2.0三服务Maven reactor。
- `evals/evals.json`：多上下文配置、协议拓扑、分片查询、能力Profile、增量失效、迁移及旧版回归对照评测。

契约回放输出必须标记 `TEST_ONLY`。它用于可重复断言，不可替代正式运行时在线查询 Code Graph。
