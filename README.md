# DSH 插件 · IP 写作工作台

在 DeepSeek Harness（DSH）侧栏打开多 IP 写作工作台，从记录选题、共同编辑到确认正文。每个 IP 都有独立的人设、目标读者和写作样例。

## 打开工作台

在 DSH 桌面端侧栏点击「写作工作台」。如果本地服务还没启动，点击面板中的「启动工作台」，页面会在 DSH 主区打开。

也可以双击 `启动工作台.bat`，在浏览器打开[本地工作台](http://127.0.0.1:8777/)。更新工作台代码后请重启本地服务。

## 首次接入 DSH

先准备 DSH 桌面端和 Python 3。在仓库根目录打开 PowerShell，执行下面的命令，将[插件目录](dsh-plugin/写作工作台/)链接到 DSH 的 `desktop` 配置。

```powershell
$pluginPath = (Resolve-Path -LiteralPath '.\dsh-plugin\写作工作台').Path -replace '\\', '/'
dsh.cmd plugin --profile desktop add "link:$pluginPath"
```

打开 DSH 的 `desktop` 配置文件，默认路径为 `%USERPROFILE%\.dsh\profiles\desktop\package.json`。在 `dsh.profile.bundles` 数组中加入 `"@local/dsh-writer-workbench"`，然后重启 DSH。插件会从仓库中启动 `serve.py`，请保留完整仓库目录。

## 当前 V1

1. 在侧栏新建或选择 IP，填写赛道和目标读者。风格与文章样例可逐步补充。
2. 在独立选题页记录想法、开稿。冲突四格保留，可边聊边补。
3. 在文章页直接编辑正文，与旁边的 AI 讨论。发送消息前先保存最新内容。
4. 阅读 AI 拟稿或修改建议，确认后采用。旧建议不能覆盖已经变化的稿件。
5. 正文满意后确认。日历记录实际写作活动。

模型与技能在设置页配置。API Key 保存在本机 `.env`，不进 Git。

正文和人设使用 Markdown，对话使用 JSONL，投放和活动使用 CSV；数据位于本地 `数据/`。原稿有历史备份，保存冲突会保留当前编辑并提示处理。

V1 首先验收正文。配图、平台排版与发布是后续范围；已有账号和数据页面仍保留。没有自动发布、在线事实核验或数据目录搬迁能力。附件能保存和打开，但 AI 不会自动读取附件或链接正文。

工作台服务使用 Python 标准库，页面使用原生 HTML/CSS/JavaScript。DSH 插件负责侧栏入口、启动服务和在主区显示工作台。

检查：`python -B -m unittest test_ai_workflow -v`。测试使用临时数据及本机模拟模型，不能替代真实写作效果验收。

接手规则见 [AGENTS.md](AGENTS.md)，当前进度见 [STATUS.md](project-memory/STATUS.md)。
