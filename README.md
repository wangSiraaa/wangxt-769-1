# 生鲜门店临期折扣管理系统

生鲜门店的商品保质期管理与临期折扣发布系统。店长可提交商品批次、创建折扣规则、发布价签，系统自动拦截违规操作。

## 业务规则

| 规则 | 说明 | 拦截方式 |
|------|------|----------|
| 过期不可打折 | 商品批次已过期时，不允许创建或发布折扣 | HTTP 422 + `EXPIRED_BATCH` |
| 最低毛利保护 | 折扣后毛利率低于批次设定最低毛利率时，不允许创建折扣 | HTTP 422 + `BELOW_MIN_PROFIT` |
| 操作人必填 | 发布价签时必须记录操作人 | HTTP 400 + `OPERATOR_REQUIRED` |

## 状态流转

```
商品批次: active → discounted → active (折扣撤销)
          active → expired (到期自动标记)

折扣规则: draft → published → revoked
          draft → rejected
```

## 角色入口

- **店长 (store_manager)**: 提交批次、创建折扣、发布价签
- **管理员 (admin)**: 系统管理

## 技术栈

- 后端: Node.js + Express + better-sqlite3
- 前端: React 18
- 部署: Docker + docker-compose

## 快速启动

```bash
# Docker 方式
docker-compose up --build -d

# 本地开发
cd backend && npm install && npm start &
cd frontend && npm install && npm start
```

访问: http://localhost:3001

## 冒烟测试

```bash
docker-compose up --build -d
./smoke.sh
```

测试覆盖:
1. 店长登录
2. 过期批次创建（状态标记 expired）
3. 对过期批次创建折扣 → 被拒绝
4. 临期批次创建
5. 低毛利折扣 → 被拒绝
6. 合法折扣创建
7. 无操作人发布 → 被拒绝
8. 正式发布价签
9. 价签记录查询

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/users/login | 用户登录 |
| GET | /api/batches | 批次列表 |
| POST | /api/batches | 新增批次 |
| GET | /api/discounts | 折扣列表 |
| POST | /api/discounts | 创建折扣 |
| POST | /api/discounts/:id/publish | 发布价签 |
| POST | /api/discounts/:id/revoke | 撤销发布 |
| GET | /api/tags | 价签记录 |
