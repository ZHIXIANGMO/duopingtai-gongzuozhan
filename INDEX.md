# INDEX.md · 文档地图

> **当前范围（2026-11-03）**：方案 A，V1 先验收正文；多 IP、独立选题页、冲突四格、日历保留。以 STATUS.md 顶部及实施计划的最新范围为准，旧原型不是正式业务入口。

> 新会话接手顺序：**[AGENTS.md](AGENTS.md)（规则与入口）→ 本文件 → [project-memory/STATUS.md](project-memory/STATUS.md)（当前状态）**。
> 然后按当前任务只读需要的文档，不要一次全读。

## 规则与设计（AI 必读）

| 文件 | 是什么 | 什么时候读 |
|---|---|---|
| [AGENTS.md](AGENTS.md) | 接手须知：怎么跑、数据契约、交互模型、接口、硬约束、坑 | 每次会话必读 |
| [规划.md](规划.md) | 设计基准：为什么这么设计 | 改数据模型 / 页面结构前必读 |
| [INDEX.md](INDEX.md) | 本文件，文档地图 | 找文档时 |

> **本轮重构入口**：[IP写作工作台实施计划](project-memory/IP写作工作台实施计划.md)（2026-11-02 确认需求、分步范围、验收与交接）；[页面结构草案](project-memory/页面结构草案.md)（第 1 步可交互原型，待用户确认）。

## 项目记忆（跨 AI 工具共享，入库）

| 文件 | 是什么 | 什么时候读 |
|---|---|---|
| [project-memory/STATUS.md](project-memory/STATUS.md) | 当前状态：进度、分支、演变史、待确认、下一步 | 每次会话必读，阶段性工作后更新 |
| [project-memory/数据契约.md](project-memory/数据契约.md) | 六实体、frontmatter、枚举、四阶段、CSV、接口表、AI 写入块 | 改数据层 / 接接口前 |
| [project-memory/交互与视觉.md](project-memory/交互与视觉.md) | 页面约定：首页三问、进度条导航、阶段面板、卡片栈、视觉变量 | 改前端页面前 |
| [project-memory/运行手册.md](project-memory/运行手册.md) | 起服务、配 AI、四个坑、已知问题排查、常用命令 | 起服务 / 排障时 |
| [knowledge-outbox/](knowledge-outbox/README.md) | 跨项目可复用的知识候选，等个人知识库接收 | 发现可沉淀知识时投递 |

## 给人看的

| 文件 | 是什么 |
|---|---|
| [README.md](README.md) | 项目介绍，人看的入口 |
| [数据/README.md](数据/README.md) | 数据目录结构说明（`数据/` 里唯一入库的文件） |

## 本地私有（不入库，见 .gitignore）

| 位置 | 是什么 | 约束 |
|---|---|---|
| `.workbuddy/memory/` | WorkBuddy 的会话日志（含过程细节） | 仅本地。内容进共享记忆前须核实 + 脱敏 |
| `数据/` | 全部私人内容（身份 / 账号 / 灵感 / 选题 / 稿件 / 投放） | 仓库 PUBLIC，绝不入库 |
| `.env` | API Key、模型配置、本地令牌及其他机密信息 | 绝不跟踪、提交或推送；旧配置经校验后迁入 |
| `.archive/` | 历史版本 | 只读 |
