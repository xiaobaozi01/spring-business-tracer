# V2.0 Spring配置上下文

每次分析先冻结 `analysisContexts`。`spring_config_resolve` 按 `propertySources` 声明顺序从低到高覆盖，处理 `.properties`、YAML多文档和 `spring.config.activate.on-profile`，再解析 `${key}`、`${key:default}` 与嵌套placeholder。循环、深度超限、缺失键和profile冲突写入 `unresolved`。

解析器只读取工作区内显式声明、非符号链接/多硬链、单文件不超过1MiB且总量不超过8MiB的 properties/yml/yaml，并用no-follow文件描述符在读取前后复验。`.properties`遵循Java续行、转义分隔符与`\uXXXX`规则；YAML map/sequence按`key[index]`确定性展开。禁止绝对路径、`..`、`.env`、pem/key/p12/pfx、credentials/secret文件。禁止环境变量、CLI、Config Server、Vault、configtree、远程import和SpEL；`${HOME}`等缺失的环境式键结构化为`EXTERNAL_ENVIRONMENT/PARTIAL`，绝不读取进程环境。真正嵌套的placeholder按最内层向外确定性解析，不能任选值。

每个值保存 `source/line/valueHash/status`。疑似password/token/secret/key/credential的键、普通或JDBC等嵌套URI中的userinfo密码和敏感query参数只保存hash和redacted，不返回原值；污点会沿placeholder、嵌套和fallback传播。`resolutionContextHash` 覆盖context顺序、profiles、值hash、未解析项和origin；CONFIG Auditor必须独立复算后提交报告。

入口、边界和持久化事实保存 `contextIds` 与实际读取的 `configDependencyIds`。增量时插件比较基线/当前值hash得到 `changedConfigKeys`，只复用不依赖变化键且服务闭包安全的入口。依赖列表缺失时保守重算。
