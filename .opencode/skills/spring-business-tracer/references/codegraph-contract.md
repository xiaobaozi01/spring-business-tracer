# V2.0 Code Graph 能力契约

## 按能力识别，不硬编码工具名

Code Graph 版本可能只公开一个综合工具（例如 explore），也可能分别公开 symbol、callee、caller、impact、status 工具。根据工具描述和一次最小查询确认能力，记录实际工具名；不要猜测或调用未公开名称。

工具包内置的 `codegraph_bounded_query` 是已安装 CodeGraph CLI 的只读薄适配器，只调用官方 `status/query/callees/callers` 并把 `limit` 触顶情况保守标准化为完整性字段；它属于 Code Graph 事实源，不属于原生调用图或文本调用图降级。优先使用该适配器。`spring_state_fingerprint.indexMetadata` 可作为索引 complete/freshness 的机器证据。共用同一 `codeGraphProjectPath` 的模块只需按唯一 projectPath 探测一次。

综合工具只有在返回内容能逐项满足下表时才算具备能力。只返回自然语言摘要但没有符号身份、边和源码位置，不算通过。

## Profile 必需能力

| 能力 | trace | scan/cross-service | impact | 缺失处理 |
|---|---:|---:|---:|---|
| Java方法级符号身份 | 必需 | 必需 | 必需 | `FAIL` |
| direct callee或可还原的逐跳调用边 | 必需 | 必需 | 必需 | `FAIL` |
| 文件和行号/范围 | 必需 | 必需 | 必需 | `FAIL` |
| 当前projectPath/index身份 | 必需 | 每个service root必需 | 必需 | `FAIL` |
| direct caller或可还原的blast-radius反向边 | 可选 | 可选 | 必需 | impact `FAIL` |
| implementation/override | 出现接口分派时必需 | 出现接口分派时必需 | 按路径需要 | 无唯一目标为`PARTIAL` |
| 索引complete/freshness | 必需 | 每个projectPath必需 | 必需 | `FAIL` |

## 最小探针

Doctor 用当前项目中一个已知 Java 方法执行最小、有限查询：

1. 唯一返回方法签名或稳定符号 ID；
2. 至少能区分“没有 callee”和“不支持 callee”；
3. 返回文件与行号或等价范围；
4. 返回/接受当前 service root 或 `projectPath`，确认不是其他项目索引；
5. impact profile 再执行一个 caller/blast-radius 探针。
6. query/callees/callers显式传 `limit=maxBranches+1`，工具响应必须明确提供`resultCount`、`truncated=false`、`completionStatus=EXPLICIT_COMPLETE`、`summaryOmittedCount=0`且结果数未触顶。只有`maxFiles`参数不满足契约。

探针不得触发自动初始化、自动重建或升级索引。索引未初始化时给出用户可执行的建议，但不自行执行。

## PASS / WARN / FAIL

### PASS

- profile 的全部必需能力可用；
- 最小探针命中当前 Java 工作区；
- 每个配置的 service root 都有明确索引身份；
- 返回结果能保存工具名、参数、符号、边和源码位置。

### WARN

- 仅存在不影响完整性的诊断警告；索引完整性和显式limit仍必须满足。

### FAIL

- 没有可用 Code Graph 工具或索引未初始化；
- 只有文件/import 图，没有方法级边；
- profile 任意必需能力缺失；
- 查询结果没有源码位置；
- index/projectPath 与配置 service root 不匹配；
- impact 没有 caller/blast-radius反向边；
- 无法证明 config/source/index/toolkit/resolvedConfig/adapterRegistry 六指纹一致。
- 查询缺少显式limit、truncated=true或结果数触顶。
- 工具schema没有显式limit/resultCount/truncated，或响应出现`... and N more`、`等N项`等摘要省略；不得由Agent自行猜为完整。

## 禁止降级

发生 `FAIL` 后禁止：

- grep 搜索 `methodName(` 并声称是调用关系；
- 用字段类型、`@Primary`、`@Qualifier` 或唯一实现类猜 Java 边；
- 用目录结构或方法同名猜跨服务目标；
- 用旧缓存冒充当前 Code Graph 结果；
- 生成看似完整的正式业务文档。

## Doctor 输出

```text
状态：PASS | WARN | FAIL
Profile：trace | scan | cross-service | impact | resume
服务源码根与projectPath：...
Code Graph实际工具：...
能力：method / callee / caller / location / implementation / index / freshness
最小探针：工具、参数摘要、命中符号与位置
指纹：config / source / index / toolkit / resolvedConfig / adapterRegistry
诊断：...
下一步：...
```
