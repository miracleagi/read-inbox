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

如果本地 `node server.js` 正在运行，扩展会优先同步到 `http://127.0.0.1:8137`，这样扩展弹窗和本地 Dashboard 会读写同一份 `.paper-inbox-data.json`。如果服务器没开，扩展会退回到 `chrome.storage.local`；从扩展弹窗打开的 Dashboard 会读写这份扩展数据。

## 作为本地网页使用

在这个目录启动本地服务器：

```sh
node server.js
```

然后打开：

```text
http://127.0.0.1:8137/dashboard.html
```

网页模式的数据通过 `server.js` 写入 `.paper-inbox-data.json`。这也是扩展在本地服务器运行时会同步的同一份数据。

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
