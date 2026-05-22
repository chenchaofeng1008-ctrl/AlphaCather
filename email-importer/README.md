# 163 邮箱日结单导入器

这个脚本用于从 163 邮箱读取盈立证券/uSMART 日结单 PDF 附件，解析资产快照和入金记录，然后调用 AlphaCather 后端导入并重算收益率曲线。

## 本地测试

1. 在 163 邮箱网页端开启 IMAP 服务，并生成客户端授权码。
2. 复制 `.env.example` 为 `.env`，填写邮箱、授权码、PDF 密码和 AlphaCather 后台密码。
3. 安装依赖并运行：

```powershell
npm install
npm run import:163
```

## 环境变量

```text
EMAIL_IMPORTER_EMAIL              163 邮箱地址
EMAIL_IMPORTER_AUTH_CODE          163 客户端授权码，不是网页登录密码
EMAIL_IMPORTER_PDF_PASSWORD       盈立结单 PDF 密码
EMAIL_IMPORTER_HKD_USD_RATE       港币兑美元汇率，默认 7.8
EMAIL_IMPORTER_SNAPSHOT_CURRENCY  保存账户总资产的币种，默认 USD
EMAIL_IMPORTER_SINCE_DAYS         往前扫描多少天邮件，默认 7
EMAIL_IMPORTER_FROM_KEYWORD       发件人关键词正则
EMAIL_IMPORTER_SUBJECT_KEYWORD    标题关键词正则
ALPHACATHER_API_BASE              AlphaCather API 地址
ALPHACATHER_ADMIN_TOKEN           AlphaCather 后台密码
```

## 自动化建议

本地测试稳定后，可以把这个脚本放到 GitHub Actions 或小型云服务器定时运行。正常运行不需要 AI token；只有 PDF 格式变化、规则识别失败时，才需要人工或 AI 辅助调整解析规则。
