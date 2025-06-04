# 图像处理 API

这是一个基于 Cloudflare Workers 的图像处理服务，提供图像上传、处理、AI 描述生成等功能。

## API 端点

| 端点              | 方法 | 描述               |
| ----------------- | ---- | ------------------ |
| `/api/v1/upload`  | POST | 上传图像文件       |
| `/api/v1/process` | POST | 处理已上传的图像   |
| `/api/v1/caption` | POST | 为图像生成 AI 描述 |
| `/api/v1/health`  | GET  | 健康检查           |

详细的 API 文档请访问：`/public/api.html`

## 开发环境设置

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
npm run dev
```

### 部署

```bash
npm run deploy
```

### 类型生成

```bash
npm run cf-typegen
wrangler types
```

## 环境变量配置

在 `wrangler.toml` 中配置以下环境变量：

查看示例填写

### ts type

需要 postgrest 的 openapi.json, 从 PGREST 根路由获取

```bash
npx openapi-typescript openapi.json -o petstore.d.ts
```
