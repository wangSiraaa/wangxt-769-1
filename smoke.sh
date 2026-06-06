#!/usr/bin/env bash
set -o pipefail

BASE_URL="${BASE_URL:-http://localhost:3099}"
PASS=0
FAIL=0

ok()   { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL + 1)); }

echo "========================================="
echo "  生鲜门店临期折扣系统 — 冒烟测试 (smoke-769)"
echo "========================================="
echo ""

echo "--- 等待服务就绪 ---"
for i in $(seq 1 30); do
  if curl -sf "$BASE_URL/api/users" > /dev/null 2>&1; then
    echo "服务已就绪 (第 ${i}s)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "服务 30s 内未就绪"
    echo "========================================="
    echo "  冒烟测试结果: ✅ $PASS 通过  ❌ $FAIL 失败"
    echo "========================================="
    exit 1
  fi
  sleep 1
done
echo ""

echo "--- 1. 登录店长账号 ---"
LOGIN=$(curl -sf -X POST "$BASE_URL/api/users/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"manager1"}')
if echo "$LOGIN" | grep -q '"ok":true'; then
  ok "店长登录成功"
  USER_ID=$(echo "$LOGIN" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "1")
else
  fail "店长登录失败: $LOGIN"
  USER_ID=1
fi
echo ""

echo "--- 2. 提交一个已过期的商品批次（带保质期说明）---"
EXPIRED=$(curl -sf -X POST "$BASE_URL/api/batches" \
  -H 'Content-Type: application/json' \
  -d '{
    "product_name":"过期牛奶",
    "sku":"MILK-EXP-001",
    "cost_price":3.00,
    "retail_price":5.00,
    "production_date":"2025-01-01",
    "shelf_life_days":30,
    "shelf_life_note":"常温保存，开启后24小时内饮用",
    "min_profit_rate":0.05,
    "created_by":1
  }')
if echo "$EXPIRED" | grep -q '"expired"'; then
  ok "过期批次创建成功，状态为 expired"
else
  fail "过期批次状态异常: $EXPIRED"
fi
EXPIRED_ID=$(echo "$EXPIRED" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "")
echo "  过期批次 ID: ${EXPIRED_ID:-N/A}"
echo ""

echo "--- 3. 对过期批次创建折扣 → 应被拒绝 (EXPIRED_BATCH) ---"
DISC_EXPIRED=$(curl -s -X POST "$BASE_URL/api/discounts" \
  -H 'Content-Type: application/json' \
  -d "{\"batch_id\":$EXPIRED_ID,\"discount_rate\":0.7}")
if echo "$DISC_EXPIRED" | grep -q 'EXPIRED_BATCH'; then
  ok "过期批次创建折扣被拒绝 (reason: EXPIRED_BATCH)"
else
  fail "过期批次创建折扣未被拒绝: $DISC_EXPIRED"
fi
echo ""

echo "--- 4. 提交一个临期商品批次（带保质期说明）---"
NEAR=$(curl -sf -X POST "$BASE_URL/api/batches" \
  -H 'Content-Type: application/json' \
  -d '{
    "product_name":"临期酸奶",
    "sku":"YOG-NR-001",
    "cost_price":4.00,
    "retail_price":8.00,
    "production_date":"2026-05-20",
    "shelf_life_days":30,
    "shelf_life_note":"冷藏保存，0-4°C最佳",
    "min_profit_rate":0.05,
    "created_by":1
  }')
if echo "$NEAR" | grep -q '"active"'; then
  ok "临期批次创建成功，状态为 active"
else
  fail "临期批次状态异常: $NEAR"
fi
NEAR_ID=$(echo "$NEAR" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "")
echo "  临期批次 ID: ${NEAR_ID:-N/A}"
echo ""

echo "--- 5. 创建折扣率过低的折扣 → 应被拒绝 (BELOW_MIN_PROFIT) ---"
DISC_LOW=$(curl -s -X POST "$BASE_URL/api/discounts" \
  -H 'Content-Type: application/json' \
  -d "{\"batch_id\":$NEAR_ID,\"discount_rate\":0.4}")
if echo "$DISC_LOW" | grep -q 'BELOW_MIN_PROFIT'; then
  ok "低于最低毛利的折扣被拒绝 (reason: BELOW_MIN_PROFIT)"
else
  fail "低毛利折扣未被拒绝: $DISC_LOW"
fi
echo ""

echo "--- 6. 创建合法折扣 (7折) → 状态应为 pending_audit ---"
DISC_OK=$(curl -sf -X POST "$BASE_URL/api/discounts" \
  -H 'Content-Type: application/json' \
  -d "{\"batch_id\":$NEAR_ID,\"discount_rate\":0.7}")
if echo "$DISC_OK" | grep -q '"pending_audit"'; then
  DISCOUNTED_PRICE=$(echo "$DISC_OK" | grep -o '"discounted_price":[0-9.]*' | head -1 | grep -o '[0-9.]*')
  ok "7折折扣创建成功，状态为 pending_audit，折后价: ¥$DISCOUNTED_PRICE"
else
  fail "7折折扣创建失败或状态异常: $DISC_OK"
fi
DISC_ID=$(echo "$DISC_OK" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "")
echo "  折扣 ID: ${DISC_ID:-N/A}"
echo ""

echo "--- 7. 审核拒绝折扣 ---"
AUDIT_REJECT=$(curl -sf -X POST "$BASE_URL/api/discounts/$DISC_ID/audit" \
  -H 'Content-Type: application/json' \
  -d "{\"conclusion\":\"rejected\",\"comment\":\"折扣力度过大，需重新评估\",\"audited_by\":$USER_ID}")
if echo "$AUDIT_REJECT" | grep -q '"rejected"'; then
  ok "审核拒绝成功，状态变为 rejected，审核结论已记录"
else
  fail "审核拒绝失败: $AUDIT_REJECT"
fi
echo ""

echo "--- 8. 对已拒绝的折扣重办 → 应重新进入待审核状态 ---"
RESUBMIT=$(curl -sf -X POST "$BASE_URL/api/discounts/$DISC_ID/resubmit" \
  -H 'Content-Type: application/json' \
  -d '{}')
if echo "$RESUBMIT" | grep -q '"pending_audit"'; then
  ok "重办成功，状态重新变为 pending_audit"
else
  fail "重办失败: $RESUBMIT"
fi
echo ""

echo "--- 9. 审核通过折扣 ---"
AUDIT_APPROVE=$(curl -sf -X POST "$BASE_URL/api/discounts/$DISC_ID/audit" \
  -H 'Content-Type: application/json' \
  -d "{\"conclusion\":\"approved\",\"comment\":\"同意该折扣方案\",\"audited_by\":$USER_ID}")
if echo "$AUDIT_APPROVE" | grep -q '"approved"'; then
  ok "审核通过成功，状态变为 draft，审核结论已记录"
else
  fail "审核通过失败: $AUDIT_APPROVE"
fi
echo ""

echo "--- 10. 撤回已通过审核的折扣 ---"
WITHDRAW=$(curl -sf -X POST "$BASE_URL/api/discounts/$DISC_ID/withdraw" \
  -H 'Content-Type: application/json' \
  -d "{\"reason\":\"需要调整折扣率\",\"withdrawn_by\":$USER_ID}")
if echo "$WITHDRAW" | grep -q '"withdrawn"'; then
  ok "撤回成功，状态变为 withdrawn"
else
  fail "撤回失败: $WITHDRAW"
fi
echo ""

echo "--- 11. 对已撤回的折扣重办 → 应重新进入待审核 ---"
RESUBMIT2=$(curl -sf -X POST "$BASE_URL/api/discounts/$DISC_ID/resubmit" \
  -H 'Content-Type: application/json' \
  -d '{}')
if echo "$RESUBMIT2" | grep -q '"pending_audit"'; then
  ok "撤回后重办成功，状态重新变为 pending_audit"
else
  fail "撤回后重办失败: $RESUBMIT2"
fi
echo ""

echo "--- 12. 再次审核通过 ---"
AUDIT_APPROVE2=$(curl -sf -X POST "$BASE_URL/api/discounts/$DISC_ID/audit" \
  -H 'Content-Type: application/json' \
  -d "{\"conclusion\":\"approved\",\"audited_by\":$USER_ID}")
if echo "$AUDIT_APPROVE2" | grep -q '"draft"'; then
  ok "再次审核通过成功"
else
  fail "再次审核通过失败: $AUDIT_APPROVE2"
fi
echo ""

echo "--- 13. 发布价签时不填操作人 → 应被拒绝 (OPERATOR_REQUIRED) ---"
PUB_NO_OP=$(curl -s -X POST "$BASE_URL/api/discounts/$DISC_ID/publish" \
  -H 'Content-Type: application/json' \
  -d '{}')
if echo "$PUB_NO_OP" | grep -q 'OPERATOR_REQUIRED'; then
  ok "无操作人发布价签被拒绝 (reason: OPERATOR_REQUIRED)"
else
  fail "无操作人发布价签未被拒绝: $PUB_NO_OP"
fi
echo ""

echo "--- 14. 正式发布价签 (带操作人) ---"
PUB_OK=$(curl -sf -X POST "$BASE_URL/api/discounts/$DISC_ID/publish" \
  -H 'Content-Type: application/json' \
  -d '{"operator":"张店长"}')
if echo "$PUB_OK" | grep -q '"ok":true'; then
  TAG_CODE=$(echo "$PUB_OK" | grep -o '"tag_code":"[^"]*"' | head -1 | sed 's/.*"tag_code":"\([^"]*\)".*/\1/' || echo "")
  PUB_OPERATOR=$(echo "$PUB_OK" | grep -o '"operator":"[^"]*"' | head -1 | sed 's/.*"operator":"\([^"]*\)".*/\1/' || echo "")
  ok "价签发布成功，编码: ${TAG_CODE:-N/A}，操作人: ${PUB_OPERATOR:-N/A}"
else
  fail "价签发布失败: $PUB_OK"
  TAG_CODE=""
  PUB_OPERATOR=""
fi
echo ""

echo "--- 15. 回读折扣列表，验证审核结论和保质期说明 ---"
DISCS=$(curl -sf "$BASE_URL/api/discounts")
HAS_AUDIT_CONCLUSION=$(echo "$DISCS" | grep -q '"audit_conclusion":"approved"' && echo "yes" || echo "no")
HAS_SHELF_NOTE=$(echo "$DISCS" | grep -q '"shelf_life_note":"冷藏保存' && echo "yes" || echo "no")
HAS_AUDITED_BY=$(echo "$DISCS" | grep -q '"audited_by_name"' && echo "yes" || echo "no")
if [ "$HAS_AUDIT_CONCLUSION" = "yes" ] && [ "$HAS_SHELF_NOTE" = "yes" ] && [ "$HAS_AUDITED_BY" = "yes" ]; then
  ok "折扣列表包含审核结论、保质期说明和审核人信息"
else
  fail "折扣列表缺少必要字段: audit_conclusion=$HAS_AUDIT_CONCLUSION, shelf_note=$HAS_SHELF_NOTE, audited_by=$HAS_AUDITED_BY"
fi
echo ""

echo "--- 16. 对已发布折扣重复发布 → 应被拒绝 (INVALID_STATUS) ---"
PUB_DUP=$(curl -s -X POST "$BASE_URL/api/discounts/$DISC_ID/publish" \
  -H 'Content-Type: application/json' \
  -d '{"operator":"李副店"}')
if echo "$PUB_DUP" | grep -q 'INVALID_STATUS'; then
  ok "重复发布被正确拒绝 (reason: INVALID_STATUS)"
else
  fail "重复发布未被拒绝: $PUB_DUP"
fi
echo ""

echo "--- 17. 对已发布折扣撤回重办验证过期拦截 ---"
WITHDRAW_PUB=$(curl -sf -X POST "$BASE_URL/api/discounts/$DISC_ID/withdraw" \
  -H 'Content-Type: application/json' \
  -d "{\"reason\":\"测试\",\"withdrawn_by\":$USER_ID}")
if echo "$WITHDRAW_PUB" | grep -q '"withdrawn"'; then
  ok "已发布折扣撤回成功"
else
  fail "已发布折扣撤回失败: $WITHDRAW_PUB"
fi
echo ""

echo "--- 18. 验证批次列表包含保质期说明 ---"
BATCHES=$(curl -sf "$BASE_URL/api/batches")
BATCH_HAS_NOTE=$(echo "$BATCHES" | grep -q '"shelf_life_note"' && echo "yes" || echo "no")
if [ "$BATCH_HAS_NOTE" = "yes" ]; then
  ok "批次列表包含保质期说明字段"
else
  fail "批次列表缺少保质期说明字段"
fi
echo ""

echo "--- 19. 回读价签记录，验证操作人与编码 ---"
TAGS=$(curl -sf "$BASE_URL/api/tags")
TAG_COUNT=$(echo "$TAGS" | grep -o '"id"' | wc -l | tr -d ' ')
TAG_FOUND_OP=$(echo "$TAGS" | grep -q '"operator":"张店长"' && echo "yes" || echo "no")
TAG_FOUND_CODE=$(echo "$TAGS" | grep -q "\"tag_code\":\"${TAG_CODE:-}\"" && echo "yes" || echo "no")
if [ "$TAG_COUNT" -ge 1 ] && [ "$TAG_FOUND_OP" = "yes" ] && [ "$TAG_FOUND_CODE" = "yes" ]; then
  ok "价签记录回读成功：共 $TAG_COUNT 条，包含操作人「张店长」和价签编码 ${TAG_CODE:-N/A}"
else
  fail "价签记录回读异常：count=$TAG_COUNT, found_op=$TAG_FOUND_OP, found_code=$TAG_FOUND_CODE, data=$TAGS"
fi
echo ""

echo "========================================="
echo "  冒烟测试结果: ✅ $PASS 通过  ❌ $FAIL 失败"
echo "========================================="

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
