# OKX Trading Bot

OKX 模拟/实盘交易机器人，带 Web 前端可视化界面。

## 快速开始

### 本地开发

```bash
pnpm install
pnpm dev
```

访问 http://localhost:4156

### Docker 部署

```bash
docker-compose up -d
```

访问 http://localhost:4156

### Docker 常用命令

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 停止
docker-compose down

# 重新构建（代码更新后）
docker-compose up -d --build
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 4156 |
| `NODE_ENV` | 运行环境 | development |

## 项目结构

```
├── server/          # 后端服务 (Express + WebSocket)
├── src/             # 前端 React 代码
├── dist/            # 构建产物
└── docker-compose.yml
```
