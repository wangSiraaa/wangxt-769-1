#!/usr/bin/env bash
set -o pipefail

BASE_URL="${BASE_URL:-http://localhost:3099}"
PASS=0
FAIL=0

ok()   { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL + 1)); }

echo "========================================="
echo "  生鲜门店临期折扣系统 — 冒烟测试"
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
else
  fail "店长登录失败: $LOGIN"
fi
echo ""

echo "--- 2. 提交一个已过期的商品批次 ---"
EXPIRED=$(curl -sf -X POST "$BASE_URL/api/batches" \
  -H 'Content-Type: application/json' \
  -d '{
    "product_name":"过期牛奶",
    "sku":"MILK-EXP-001",
    "cost_price":3.00,
    "retail_price":5.00,
    "production_date":"2025-01-01",
    "shelf_life_days":30,
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

echo "--- 4. 提交一个临期商品批次 ---"
NEAR=$(curl -sf -X POST "$BASE_URL/api/batches" \
  -H 'Content-Type: application/json' \
  -d '{
    "product_name":"临期酸奶",
    "sku":"YOG-NR-001",
    "cost_price":4.00,
    "retail_price":8.00,
    "production_date":"2026-05-20",
    "shelf_life_days":30,
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

echo "--- 6. 创建合法折扣 (7折) ---"
DISC_OK=$(curl -sf -X POST "$BASE_URL/api/discounts" \
  -H 'Content-Type: application/json' \
  -d "{\"batch_id\":$NEAR_ID,\"discount_rate\":0.7}")
if echo "$DISC_OK" | grep -q '"ok":true'; then
  DISCOUNTED_PRICE=$(echo "$DISC_OK" | grep -o '"discounted_price":[0-9.]*' | head -1 | grep -o '[0-9.]*')
  ok "7折折扣创建成功，折后价: ¥$DISCOUNTED_PRICE"
else
  fail "7折折扣创建失败: $DISC_OK"
fi
DISC_ID=$(echo "$DISC_OK" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "")
echo "  折扣 ID: ${DISC_ID:-N/A}"
echo ""

echo "--- 7. 发布价签时不填操作人 → 应被拒绝 (OPERATOR_REQUIRED) ---"
PUB_NO_OP=$(curl -s -X POST "$BASE_URL/api/discounts/$DISC_ID/publish" \
  -H 'Content-Type: application/json' \
  -d '{}')
if echo "$PUB_NO_OP" | grep -q 'OPERATOR_REQUIRED'; then
  ok "无操作人发布价签被拒绝 (reason: OPERATOR_REQUIRED)"
else
  fail "无操作人发布价签未被拒绝: $PUB_NO_OP"
fi
echo ""

echo "--- 8. 正式发布价签 (带操作人) ---"
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

echo "--- 9. 回读价签记录，验证操作人与编码 ---"
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

echo "--- 10. 对已发布折扣重复发布 → 应被拒绝 (INVALID_STATUS) ---"
PUB_DUP=$(curl -s -X POST "$BASE_URL/api/discounts/$DISC_ID/publish" \
  -H 'Content-Type: application/json' \
  -d '{"operator":"李副店"}')
if echo "$PUB_DUP" | grep -q 'INVALID_STATUS'; then
  ok "重复发布被正确拒绝 (reason: INVALID_STATUS)"
else
  fail "重复发布未被拒绝: $PUB_DUP"
fi
echo ""

echo "========================================="
echo "  冒烟测试结果: ✅ $PASS 通过  ❌ $FAIL 失败"
echo "========================================="

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
