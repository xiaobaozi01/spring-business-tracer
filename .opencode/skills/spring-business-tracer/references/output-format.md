# V2.0 输出与发布

## 目录

```text
docs/spring-business/
  current.json
  snapshots/{run-id}/
    index.md
    manifest.json
    entrypoints/{entry-id}.md
    graph/{meta.json,nodes.jsonl,edges.jsonl}
  .staging/{run-id}/
```

`entry-id` 由 service、入口类型、完整触发器和完整方法签名生成稳定小写 ASCII ID，不能只用方法名。只有 `VERIFIED` 单元能写正式文档。

## 入口文档模板

```markdown
# {入口标题}

> 状态：PASS | WARN | PARTIAL | FAIL | TEST_ONLY
> 入口ID：...
> Service：...
> 触发器：...
> Run/config/source/index/toolkit/resolvedConfig/adapterRegistry指纹：...
> 验证：validator + validationHash

## 业务摘要
## 入口信息
## 主业务流程
## 技术调用链
## 跨服务与异步边界
## 数据库访问
## 事务、分支与副作用
## 待确认项
## 源码证据
## Code Graph查询记录
## 独立验证结果
```

技术调用链中明确区分：

```text
A -> B                         # CODEGRAPH_JAVA_EDGE
B ==[FEIGN_HTTP evidence]=> C # VERIFIED_LOGICAL_BOUNDARY
C -> D                         # CODEGRAPH_JAVA_EDGE
```

## manifest.json

Manifest 是文档导航和审计清单；可查询调用图位于同一不可变快照的graph目录。至少包含：

- schemaVersion、runId、config/source/index/toolkit/resolvedConfig/adapterRegistry 六指纹和graphHash；
- 服务、入口、表、逻辑边界文档路径及内容哈希；
- 每个入口的状态、validationHash 和未确认项数量；
- 启用的入口 adapters 及发现数量；
- 生成时间与实际 Code Graph 工具名。

`/spring-query` 默认查询快照；只有 `--live` 才在线调用 Code Graph。

## 汇总页

`index.md` 展示：

- 服务、入口类型和入口总数；
- 已验证/部分/阻塞/过期数量；
- 表与 CRUD 汇总；
- 跨服务边界及未解决边；
- 覆盖率与验证率；
- 最近 run、指纹和继续命令。

## 状态规则

- `PASS`：本入口全部分支证据完整并独立验证通过。
- `WARN`：主链完整，只有不影响事实的 Doctor 警告。
- `PARTIAL`：动态边、歧义、上限、未支持入口或持久化证据不完整。
- `FAIL`：核心 Code Graph 能力、入口身份或证据链失败。
- `TEST_ONLY`：固定契约回放，不能作为真实项目结果。

全项目 run 的 `COMPLETE` 比单入口 `PASS` 更严格：全部 inventory 单元必须PUBLISHED/REUSED、覆盖/边界审计通过、实际文档哈希与graphHash通过，且快照原子发布。否则 run 为 `PARTIAL/PAUSED/FAILED/STALE`。
