const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/", (req, res) => {
  const rows = db.all(`
    SELECT d.*, b.product_name, b.sku, b.cost_price, b.retail_price,
           b.expiry_date, b.min_profit_rate, b.status AS batch_status
    FROM discount_rules d
    JOIN product_batches b ON d.batch_id = b.id
    ORDER BY d.created_at DESC
  `);
  res.json({ ok: true, data: rows });
});

router.post("/", (req, res) => {
  const { batch_id, discount_rate } = req.body;

  if (!batch_id || discount_rate == null) {
    return res.status(400).json({ ok: false, msg: "缺少必填字段 batch_id / discount_rate" });
  }

  const batch = db.get("SELECT * FROM product_batches WHERE id = ?", [batch_id]);
  if (!batch) return res.status(404).json({ ok: false, msg: "批次不存在" });

  const today = new Date().toISOString().slice(0, 10);

  if (batch.expiry_date <= today) {
    return res.status(422).json({
      ok: false,
      msg: "该批次已过期，不允许创建临期折扣",
      reason: "EXPIRED_BATCH",
      detail: { expiry_date: batch.expiry_date, today },
    });
  }

  const discountedPrice = Math.round(batch.retail_price * discount_rate * 100) / 100;
  const grossProfitRate = (discountedPrice - batch.cost_price) / discountedPrice;

  if (grossProfitRate < batch.min_profit_rate) {
    return res.status(422).json({
      ok: false,
      msg: `折扣后毛利率 ${(grossProfitRate * 100).toFixed(2)}% 低于最低毛利要求 ${(batch.min_profit_rate * 100).toFixed(2)}%`,
      reason: "BELOW_MIN_PROFIT",
      detail: {
        discounted_price: discountedPrice,
        gross_profit_rate: grossProfitRate,
        min_profit_rate: batch.min_profit_rate,
      },
    });
  }

  const info = db.run(
    `INSERT INTO discount_rules (batch_id, discount_rate, discounted_price, gross_profit_rate, status)
    VALUES (?, ?, ?, ?, 'draft')`,
    [batch_id, discount_rate, discountedPrice, grossProfitRate]
  );

  db.run("UPDATE product_batches SET status = 'discounted' WHERE id = ?", [batch_id]);

  res.status(201).json({
    ok: true,
    data: {
      id: info.lastInsertRowid,
      discounted_price: discountedPrice,
      gross_profit_rate: Math.round(grossProfitRate * 10000) / 10000,
    },
  });
});

router.post("/:id/publish", (req, res) => {
  const { operator } = req.body;
  if (!operator) {
    return res.status(400).json({
      ok: false,
      msg: "价签发布必须记录操作人",
      reason: "OPERATOR_REQUIRED",
    });
  }

  const discount = db.get(`
    SELECT d.*, b.expiry_date, b.min_profit_rate, b.cost_price, b.status AS batch_status
    FROM discount_rules d
    JOIN product_batches b ON d.batch_id = b.id
    WHERE d.id = ?
  `, [req.params.id]);

  if (!discount) return res.status(404).json({ ok: false, msg: "折扣规则不存在" });

  const today = new Date().toISOString().slice(0, 10);

  if (discount.expiry_date <= today) {
    return res.status(422).json({
      ok: false,
      msg: "该批次已过期，不允许发布折扣价签",
      reason: "EXPIRED_BATCH",
      detail: { expiry_date: discount.expiry_date, today },
    });
  }

  if (discount.gross_profit_rate < discount.min_profit_rate) {
    return res.status(422).json({
      ok: false,
      msg: "折扣后毛利率低于最低要求，不允许发布",
      reason: "BELOW_MIN_PROFIT",
    });
  }

  if (discount.status !== "draft") {
    return res.status(409).json({
      ok: false,
      msg: `折扣规则当前状态为 ${discount.status}，仅草稿状态可发布`,
      reason: "INVALID_STATUS",
    });
  }

  const now = new Date().toISOString();
  db.run(
    `UPDATE discount_rules SET status = 'published', operator = ?, published_at = ? WHERE id = ?`,
    [operator, now, req.params.id]
  );

  const tagCode = `TAG-${Date.now()}-${req.params.id}`;
  db.run(
    `INSERT INTO price_tags (discount_id, operator, tag_code) VALUES (?, ?, ?)`,
    [req.params.id, operator, tagCode]
  );

  res.json({
    ok: true,
    data: { tag_code: tagCode, operator, published_at: now },
  });
});

router.post("/:id/revoke", (req, res) => {
  const discount = db.get("SELECT * FROM discount_rules WHERE id = ?", [req.params.id]);
  if (!discount) return res.status(404).json({ ok: false, msg: "折扣规则不存在" });
  if (discount.status !== "published") {
    return res.status(409).json({ ok: false, msg: "仅已发布状态可撤销" });
  }
  db.run("UPDATE discount_rules SET status = 'revoked' WHERE id = ?", [req.params.id]);
  db.run("UPDATE product_batches SET status = 'active' WHERE id = ?", [discount.batch_id]);
  res.json({ ok: true, msg: "已撤销发布" });
});

module.exports = router;
