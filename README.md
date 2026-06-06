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

折扣规则: pending_audit → draft → published → revoked
          pending_audit → rejected → withdrawn → pending_audit (重办)
          draft → withdrawn → pending_audit (重办)
          published → withdrawn → pending_audit (重办)
```

## 角色入口

- **店长 (store_manager)**: 提交批次、创建折扣、审核折扣、发布价签、撤回重办
- **管理员 (admin)**: 系统管理

## 核心功能

### 1. 审核流程
- 折扣创建后自动进入「待审核」状态
- 支持审核通过 / 审核拒绝，记录审核结论和审核意见
- 审核通过后进入「草稿」状态，可发布价签

### 2. 撤回重办
- 已发布、草稿、已拒绝状态的折扣均可撤回
- 撤回后可「重办」，重新进入审核流程
- 记录撤回原因和撤回人

### 3. 保质期说明落库
- 商品批次支持录入保质期说明（如：冷藏保存，0-4°C最佳）
- 折扣列表展示关联批次的保质期说明

### 4. 审核结论展示
- 前端展示审核结论（通过/拒绝）
- 展示审核意见、审核人、审核时间
- 展示撤回人、撤回原因

### 5. 过期商品全链路拦截
「过期商品不能打折销售」规则在以下环节强制执行：
- 创建折扣时拦截
- 审核通过时拦截
- 发布价签时拦截
- 重办折扣时拦截

## 技术栈

- 后端: Node.js + Express + sql.js
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

访问: http://localhost:3099

## 冒烟测试

```bash
docker-compose up --build -d
./smoke.sh
```

测试覆盖 (smoke-769):
1. 店长登录
2. 过期批次创建（带保质期说明，状态标记 expired）
3. 对过期批次创建折扣 → 被拒绝
4. 临期批次创建（带保质期说明）
5. 低毛利折扣 → 被拒绝
6. 合法折扣创建 → 进入待审核状态
7. 审核拒绝折扣
8. 已拒绝折扣重办 → 重新待审核
9. 审核通过折扣
10. 撤回已通过审核的折扣
11. 已撤回折扣重办 → 重新待审核
12. 再次审核通过
13. 无操作人发布 → 被拒绝
14. 正式发布价签
15. 回读折扣列表验证审核结论和保质期说明
16. 重复发布 → 被拒绝
17. 已发布折扣撤回
18. 验证批次列表包含保质期说明
19. 价签记录回读验证

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/users/login | 用户登录 |
| GET | /api/batches | 批次列表 |
| POST | /api/batches | 新增批次 |
| GET | /api/discounts | 折扣列表（含审核信息、保质期说明） |
| POST | /api/discounts | 创建折扣（进入待审核） |
| POST | /api/discounts/:id/audit | 审核折扣（通过/拒绝） |
| POST | /api/discounts/:id/withdraw | 撤回折扣 |
| POST | /api/discounts/:id/resubmit | 重办折扣 |
| POST | /api/discounts/:id/publish | 发布价签 |
| POST | /api/discounts/:id/revoke | 撤销发布 |
| GET | /api/tags | 价签记录 |
