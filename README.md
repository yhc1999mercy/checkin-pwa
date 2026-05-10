# iPhone 快捷指令打卡方案

这个目录里的 `Code.gs` 是 Google Sheets 的后端脚本。配置完成后，你在 iPhone 上点快捷指令，就会把当前时间写入表格，并自动生成每日汇总和图表。

## 1. 创建 Google 表格

1. 新建一个 Google Sheets，命名为 `个人打卡记录`。
2. 打开菜单：`扩展程序` -> `Apps Script`。
3. 删除默认代码，把本目录的 `Code.gs` 全部复制进去。
4. 保存项目，命名为 `个人打卡接口`。
5. 在 Apps Script 里先手动运行一次 `setupSheets`，按提示授权。

## 2. 部署 Web App

1. Apps Script 右上角点 `部署` -> `新建部署`。
2. 类型选择 `Web 应用`。
3. 执行身份选择 `我`。
4. 访问权限选择 `任何人`。
5. 点 `部署`，复制生成的 Web App URL。

这个 URL 后面会填进 iPhone 快捷指令。

## 3. 创建 iPhone 快捷指令

先建一个快捷指令，例如 `打卡-上班`：

1. 打开 iPhone `快捷指令` App。
2. 新建快捷指令，名称填 `打卡-上班`。
3. 添加操作：`获取 URL 内容`。
4. URL 填第 2 步复制的 Web App URL。
5. 方法选择 `POST`。
6. 请求正文选择 `JSON`。
7. 添加这些字段：

```json
{
  "action": "上班",
  "source": "iPhone Shortcut"
}
```

然后复制这个快捷指令 5 次，只改 `action` 字段和名称：

| 快捷指令名称 | action |
|---|---|
| 打卡-上班 | 上班 |
| 打卡-午休开始 | 午休开始 |
| 打卡-午休结束 | 午休结束 |
| 打卡-晚饭开始 | 晚饭开始 |
| 打卡-晚饭结束 | 晚饭结束 |
| 打卡-下班 | 下班 |

## 4. 放到 iPhone 桌面

每个快捷指令都可以：

1. 点快捷指令右上角 `...`。
2. 点分享按钮。
3. 选择 `添加到主屏幕`。

也可以放进小组件，这样不用打开 App。

## 5. 查看结果

Google Sheets 会自动维护 3 个工作表：

| 工作表 | 用途 |
|---|---|
| 打卡记录 | 每次点击快捷指令产生一条原始记录 |
| 每日汇总 | 自动汇总每天上下班、午休、晚饭和工作时长 |
| 图表 | 自动生成工作时长趋势和上下班时间趋势 |

工作时长计算方式：

```text
工作时长 = 下班 - 上班 - 午休时长 - 晚饭时长
```

## 6. 测试

部署后，可以先在 iPhone 上点 `打卡-上班`。如果表格里出现一条 `上班` 记录，说明配置成功。

如果快捷指令里想显示成功提示，可以在 `获取 URL 内容` 后面加一个 `显示通知` 操作，通知内容使用上一步返回结果里的 `message`。

## 7. 使用 PWA

当前目录也包含一个小型 PWA：

| 文件 | 用途 |
|---|---|
| `index.html` | 应用入口 |
| `app.js` | 打卡、读取数据、画图逻辑 |
| `styles.css` | 页面样式 |
| `manifest.webmanifest` | PWA 安装信息 |
| `sw.js` | 离线缓存 |
| `apple-touch-icon.png` | iPhone 主屏幕图标 |
| `icon-192.png` / `icon-512.png` | PWA 应用图标 |

PWA 会复用同一个 Apps Script Web App URL。因为浏览器访问 Apps Script 会遇到跨域限制，`Code.gs` 已经增加了 PWA 专用的 JSONP 接口。

如果你已经部署过旧版 `Code.gs`，需要重新部署：

1. 打开 Apps Script。
2. 把新版 `Code.gs` 复制进去并保存。
3. 点 `部署` -> `管理部署`。
4. 编辑当前 Web App。
5. 版本选择 `新版本`。
6. 点 `部署`。

本地测试：

```bash
python3 -m http.server 5173
```

然后在浏览器打开：

```text
http://localhost:5173
```

第一次打开 PWA 时，把 Apps Script Web App URL 粘贴到输入框并保存。之后可以直接打卡、看今日记录、看每日汇总和趋势图。

iPhone 使用：

1. 把这些 PWA 文件部署到一个 HTTPS 静态网站。
2. 用 iPhone Safari 打开网站。
3. 点分享按钮。
4. 选择 `添加到主屏幕`。

注意：PWA 真正安装到 iPhone 主屏幕时，需要 HTTPS。`localhost` 只适合在电脑上测试。

当前 GitHub Pages 地址：

```text
https://yhc1999mercy.github.io/checkin-pwa/
```

## 贡献者

| 贡献者 | 内容 |
|---|---|
| yhc1999mercy | 需求、配置和使用反馈 |
| Codex | PWA、Apps Script 接口和部署协助 |
