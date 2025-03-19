# WeChat Work Coze Bot

一个基于企业微信和 Coze API 的智能对话机器人。

## 功能特点

- 支持企业微信消息的接收和回复
- 集成 Coze API 进行智能对话
- 支持 Markdown 格式的消息回复
- 自动处理长消息的分段发送
- 提供等待提示，优化用户体验

## 环境要求

- Docker 运行环境
- 企业微信管理员权限
- Coze API 访问权限

## 快速开始

### 1. 准备环境变量

创建 `.env` 文件，包含以下配置：

```env
# WeChat Work Configuration
WECHAT_TOKEN=你的企业微信Token
WECHAT_ENCODING_AES_KEY=你的企业微信EncodingAESKey
WECHAT_CORP_ID=你的企业微信CorpID
WECHAT_CORP_SECRET=你的企业微信Secret

# Coze Configuration
COZE_TOKEN=你的Coze API Token
COZE_BOT_ID=你的Coze Bot ID

# Server Configuration
PORT=3001
```

### 2. 使用 Docker 运行

```bash
# 拉取镜像
docker pull xianyan/wechat-coze-bot:latest

# 运行容器
docker run -d \
  --name wechat-coze-bot \
  -p 3001:3001 \
  --env-file .env \
  xianyan/wechat-coze-bot:latest
```

### 3. 使用 Docker Compose 运行

创建 `docker-compose.yml` 文件：

```yaml
version: '3'
services:
  wechat-coze-bot:
    image: xianyan/wechat-coze-bot:latest
    ports:
      - "3001:3001"
    env_file:
      - .env
    restart: unless-stopped
```

然后运行：

```bash
docker-compose up -d
```

## 配置说明

### 企业微信配置

1. 登录企业微信管理后台
2. 创建一个企业应用
3. 获取以下信息并填入 `.env` 文件：
   - CorpID
   - Secret
   - Token
   - EncodingAESKey

### Coze 配置

1. 登录 Coze 平台
2. 创建或选择一个 Bot
3. 获取以下信息并填入 `.env` 文件：
   - API Token
   - Bot ID

## 日志查看

```bash
# 查看容器日志
docker logs wechat-coze-bot

# 实时跟踪日志
docker logs -f wechat-coze-bot
```

## 常见问题

1. **Q: 容器无法启动？**
   A: 检查环境变量是否正确配置，端口是否被占用。

2. **Q: 消息发送失败？**
   A: 检查企业微信的 Secret 是否正确，网络是否通畅。

3. **Q: Coze API 调用失败？**
   A: 确认 Coze Token 是否有效，Bot ID 是否正确。

## 注意事项

- 请妥善保管所有密钥信息
- 定期检查日志以监控运行状态
- 建议配置容器自动重启策略

## 许可证

MIT License 