# Paper Inbox

Paper Inbox 是一个本地优先的论文阅读队列 MVP，用来把 Chrome 里越攒越多的 arXiv / paper tabs 收进一个可处理的 inbox。

## 当前功能

- Chrome 扩展弹窗保存当前 tab
- 一键保存所有 Chrome 窗口里的论文相关 tabs：arXiv、alphaXiv、GitHub、`*.github.io`、Hugging Face、X / Twitter
- 可选保存后关闭这些论文 tabs
- 批量保存任务在扩展 background worker 中执行，popup 关闭后不会中断
- 当前页是 X / Twitter 时，自动提取页面里的 arXiv / DOI 链接
- X / Twitter 页面会直接保存原 URL 和标题；如果能解析出 arXiv / DOI，也会额外保存解析出的论文
- arXiv ID 识别、去重、PDF 链接生成
- arXiv 元数据补全：标题、作者、摘要、发布日期、分类
- Dashboard：状态流转、来源过滤、优先级、本周标记、标签、搜索、阅读笔记
- 批量导入 URL、JSON 导出
- 不依赖外部 npm 包，本地服务器模式下数据写入 `.paper-inbox-data.json`

## 作为 Chrome 扩展使用

1. 打开 Chrome 的 `chrome://extensions/`
2. 开启 Developer mode
3. 选择 Load unpacked
4. 选择克隆后的项目目录，例如：`/path/to/read-inbox`
5. 固定 Paper Inbox 扩展

扩展和本地 Dashboard 都只读写 `http://127.0.0.1:8137` 背后的 `.paper-inbox-data.json`。使用扩展前需要先启动本地服务；如果服务没开，扩展弹窗和 Dashboard 会提示本地服务不可用，不会再写入 `chrome.storage.local` 或浏览器 `localStorage`。

## 作为本地网页使用

在这个目录启动本地服务器：

```sh
node server.js
```

然后打开：

```text
http://127.0.0.1:8137/dashboard.html
```

网页模式的数据通过 `server.js` 写入 `.paper-inbox-data.json`。扩展也使用这同一份数据，避免多存储源合并导致已删除条目重新出现。

`server.js` 还提供 `/api/arxiv/:id`，用于绕过普通网页模式下浏览器对 arXiv API 的跨域限制。

## 常驻本地服务

macOS LaunchAgent 模板文件在：

```text
launchd/com.paper-inbox.server.plist
```

安装前先把 plist 里的 `/path/to/read-inbox` 替换成你本机的项目绝对路径。安装后会在登录时自动启动 `node server.js`，并保持 `http://127.0.0.1:8137` 可用。日志写入：

```text
logs/server.out.log
logs/server.err.log
```

## 常用命令

在前台临时启动本地服务：

```sh
node server.js
```

使用其他端口启动：

```sh
PORT=8147 node server.js
```

检查服务是否可用：

```sh
curl http://127.0.0.1:8137/api/store
```

首次安装 macOS LaunchAgent：

```sh
mkdir -p logs ~/Library/LaunchAgents
sed "s#/path/to/read-inbox#$(pwd)#g" launchd/com.paper-inbox.server.plist > ~/Library/LaunchAgents/com.paper-inbox.server.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.paper-inbox.server.plist
```

重启常驻服务：

```sh
launchctl kickstart -k gui/$(id -u)/com.paper-inbox.server
```

查看常驻服务状态：

```sh
launchctl print gui/$(id -u)/com.paper-inbox.server
```

停止并卸载常驻服务：

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.paper-inbox.server.plist
```

查看服务日志：

```sh
tail -f logs/server.out.log logs/server.err.log
```

备份本地数据到仓库外：

```sh
mkdir -p ~/paper-inbox-backups
cp .paper-inbox-data.json ~/paper-inbox-backups/paper-inbox-data-$(date +%F).json
```

清空本地服务数据：

```sh
curl -X DELETE http://127.0.0.1:8137/api/store
```

## 数据模型

每篇论文包含：

- title
- authors
- abstract
- arxivId / doi
- sourceUrl / pdfUrl
- originUrl / originTitle / originText
- status: inbox, read_later, done, archived
- planned: independent weekly marker shown on papers, not a sidebar status
- priority: high, medium, low
- tags
- planned
- savedReason
- notes
- addedAt / updatedAt
