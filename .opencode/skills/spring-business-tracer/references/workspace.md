# 准备与配置

## Doctor

`doctor` 无参数默认 trace；明确传入 scan/cross-service/impact/resume 时采用指定模式。

1. 查看已公开的 Code Graph 工具，按能力使用实际名称。MCP 优先；只有 CLI 可用时使用已安装 CLI 的只读 status/explore/query/callees/callers，不安装、不初始化、不刷新。
2. 读取已有 `docs/spring-business/workspace.md`。首次使用时根据构建模块和启动入口识别可部署服务/共享模块，注明假设；多服务归属无法确定时只询问这项缺失信息。
3. 每个不同的索引根检查一次状态，记录源码根、索引根、索引版本/时间及是否新鲜。工具未返回的字段写“不可用”。未建立索引时说明缺口，不能降级成文本调用图。
4. 用一个已知方法做最小直接callee探针，确认身份、文件位置和调用边；impact 再确认 callers。仅返回摘要的工具不能证明全量调用链完整。

trace 检查目标所在索引；scan 检查所选服务；跨服务继续分析要求两端源码/索引可访问，缺失端作为外部边界；resume 对比记录的版本和范围。返回 PASS/PARTIAL/FAIL、实际查询、缺口与下一步，不先进行全库扫描。

## 工作区说明

首次分析由主 Agent 在文档目录写 workspace.md，记录服务ID/源码根/索引根/别名、共享模块、范围内的入口类型、排除目录、上下文名/active profiles/允许阅读的配置文件。不要让用户填写一大份配置协议。

单服务可根据唯一启动应用作默认范围；同一个 Maven reactor 不等于一个服务，公共模块也不能当作可部署服务。默认排除测试、构建产物、第三方包和生成代码；用户显式指定时再纳入。

用户已有旧版 `.opencode/spring-business-tracer.json` 时，仅将服务、共享模块、上下文和分析范围转记到 workspace.md，不执行其中的命令或恢复旧状态机。工具包不再分发或要求此JSON配置。

## Profile 与配置来源

按用户选择的 context 分开分析。记录实际激活的 profile 和声明的本地 property source 顺序，读取与入口/边界/表访问有关的键和来源行号；同名键覆盖要给出依据。仅在本地值/默认值可唯一确定时展开 placeholder，嵌套值逐项追溯并检测循环。

遇到 profile 条件表达式、导入顺序、复杂 YAML 合并、环境变量、远程配置、SpEL 或运行时 Bean 注入无法确认时，记录未解析原因。不要模拟完整 Spring Environment，也不要把手工静态解析称为运行时实值。秘密值及依赖秘密的值只记“已隐藏”，不能用于输出可逆推的证据。

跨 context 的事实保持 context 标签。配置来源、profile或键发生变化时，相应依赖入口需要重查；依赖不清楚时扩大重查范围。
