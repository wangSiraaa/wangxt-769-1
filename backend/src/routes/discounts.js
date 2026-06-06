const express = require("express");
const router = express.Router();
const db = require("../db");

function isBatchExpired(expiryDate) {
  const today = new Date().toISOString().slice(0, 10);
  return expiryDate <= today;
}

router.get("/", (req, res) => {
  const rows = db.all(`
    SELECT d.*, b.product_name, b.sku, b.cost_price, b.retail_price,
           b.expiry_date, b.shelf_life_note, b.min_profit_rate, b.status AS batch_status,
           u1.display_name AS audited_by_name,
           u2.display_name AS withdrawn_by_name
    FROM discount_rules d
    JOIN product_batches b ON d.batch_id = b.id
    LEFT JOIN users u1 ON d.audited_by = u1.id
    LEFT JOIN users u2 ON d.withdrawn_by = u2.id
    ORDER BY d.created_at DESC
  `);
  res.json({ ok: true, data: rows });
});

router.post("/", (req, res) => {
  const { batch_id, discount_rate, created_by } = req.body;

  if (!batch_id || discount_rate == null) {
    return res.status(400).json({ ok: false, msg: "缺少必填字段 batch_id / discount_rate" });
  }

  const batch = db.get("SELECT * FROM product_batches WHERE id = ?", [batch_id]);
  if (!batch) return res.status(404).json({ ok: false, msg: "批次不存在" });

  if (isBatchExpired(batch.expiry_date)) {
    return res.status(422).json({
      ok: false,
      msg: "该批次已过期，不允许创建临期折扣",
      reason: "EXPIRED_BATCH",
      detail: { expiry_date: batch.expiry_date, today: new Date().toISOString().slice(0, 10) },
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
    VALUES (?, ?, ?, ?, 'pending_audit')`,
    [batch_id, discount_rate, discountedPrice, grossProfitRate]
  );

  db.run("UPDATE product_batches SET status = 'discounted' WHERE id = ?", [batch_id]);

  res.status(201).json({
    ok: true,
    data: {
      id: info.lastInsertRowid,
      discounted_price: discountedPrice,
      gross_profit_rate: Math.round(grossProfitRate * 10000) / 10000,
      status: "pending_audit",
    },
  });
});

router.post("/:id/audit", (req, res) => {
  const { conclusion, comment, audited_by } = req.body;

  if (!conclusion || !["approved", "rejected"].includes(conclusion)) {
    return res.status(400).json({ ok: false, msg: "审核结论必须为 approved 或 rejected" });
  }
  if (!audited_by) {
    return res.status(400).json({ ok: false, msg: "缺少审核人" });
  }

  const discount = db.get(`
    SELECT d.*, b.expiry_date, b.min_profit_rate, b.cost_price, b.status AS batch_status, b.retail_price
    FROM discount_rules d
    JOIN product_batches b ON d.batch_id = b.id
    WHERE d.id = ?
  `, [req.params.id]);

  if (!discount) return res.status(404).json({ ok: false, msg: "折扣规则不存在" });

  if (discount.status !== "pending_audit" && discount.status !== "withdrawn") {
    return res.status(409).json({
      ok: false,
      msg: `折扣规则当前状态为 ${discount.status}，仅待审核或已撤回状态可审核`,
      reason: "INVALID_STATUS",
    });
  }

  if (conclusion === "approved" && isBatchExpired(discount.expiry_date)) {
    return res.status(422).json({
      ok: false,
      msg: "该批次已过期，审核不允许通过",
      reason: "EXPIRED_BATCH",
      detail: { expiry_date: discount.expiry_date, today: new Date().toISOString().slice(0, 10) },
    });
  }

  if (conclusion === "approved" && discount.gross_profit_rate < discount.min_profit_rate) {
    return res.status(422).json({
      ok: false,
      msg: "折扣后毛利率低于最低要求，审核不允许通过",
      reason: "BELOW_MIN_PROFIT",
    });
  }

  const now = new Date().toISOString();
  const newStatus = conclusion === "approved" ? "draft" : "rejected";

  db.run(
    `UPDATE discount_rules 
     SET status = ?, audit_conclusion = ?, audit_comment = ?, audited_by = ?, audited_at = ?, reject_reason = ?
     WHERE id = ?`,
    [newStatus, conclusion, comment || null, audited_by, now, conclusion === "rejected" ? (comment || "审核未通过") : null, req.params.id]
  );

  res.json({
    ok: true,
    data: { id: req.params.id, status: newStatus, audit_conclusion: conclusion, audited_at: now },
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

  if (isBatchExpired(discount.expiry_date)) {
    return res.status(422).json({
      ok: false,
      msg: "该批次已过期，不允许发布折扣价签",
      reason: "EXPIRED_BATCH",
      detail: { expiry_date: discount.expiry_date, today: new Date().toISOString().slice(0, 10) },
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

router.post("/:id/withdraw", (req, res) => {
  const { reason, withdrawn_by } = req.body;

  if (!withdrawn_by) {
    return res.status(400).json({ ok: false, msg: "缺少撤回操作人" });
  }

  const discount = db.get("SELECT * FROM discount_rules WHERE id = ?", [req.params.id]);
  if (!discount) return res.status(404).json({ ok: false, msg: "折扣规则不存在" });

  if (!["published", "draft", "rejected"].includes(discount.status)) {
    return res.status(409).json({
      ok: false,
      msg: `折扣规则当前状态为 ${discount.status}，不可撤回`,
      reason: "INVALID_STATUS",
    });
  }

  const now = new Date().toISOString();
  db.run(
    `UPDATE discount_rules SET status = 'withdrawn', withdraw_reason = ?, withdrawn_by = ?, withdrawn_at = ? WHERE id = ?`,
    [reason || null, withdrawn_by, now, req.params.id]
  );

  if (discount.status === "published") {
    db.run("UPDATE product_batches SET status = 'active' WHERE id = ?", [discount.batch_id]);
  }

  res.json({
    ok: true,
    data: { id: req.params.id, status: "withdrawn", withdrawn_at: now },
  });
});

router.post("/:id/resubmit", (req, res) => {
  const discount = db.get(`
    SELECT d.*, b.expiry_date, b.min_profit_rate, b.cost_price, b.retail_price
    FROM discount_rules d
    JOIN product_batches b ON d.batch_id = b.id
    WHERE d.id = ?
  `, [req.params.id]);

  if (!discount) return res.status(404).json({ ok: false, msg: "折扣规则不存在" });

  if (discount.status !== "withdrawn" && discount.status !== "rejected") {
    return res.status(409).json({
      ok: false,
      msg: `折扣规则当前状态为 ${discount.status}，仅已撤回或已拒绝状态可重办`,
      reason: "INVALID_STATUS",
    });
  }

  if (isBatchExpired(discount.expiry_date)) {
    return res.status(422).json({
      ok: false,
      msg: "该批次已过期，不允许重办临期折扣",
      reason: "EXPIRED_BATCH",
      detail: { expiry_date: discount.expiry_date, today: new Date().toISOString().slice(0, 10) },
    });
  }

  if (discount.gross_profit_rate < discount.min_profit_rate) {
    return res.status(422).json({
      ok: false,
      msg: "折扣后毛利率低于最低要求，请调整折扣率后重办",
      reason: "BELOW_MIN_PROFIT",
    });
  }

  db.run(
    `UPDATE discount_rules 
     SET status = 'pending_audit', audit_conclusion = NULL, audit_comment = NULL, 
         audited_by = NULL, audited_at = NULL, reject_reason = NULL,
         withdraw_reason = NULL, withdrawn_by = NULL, withdrawn_at = NULL
     WHERE id = ?`,
    [req.params.id]
  );

  db.run("UPDATE product_batches SET status = 'discounted' WHERE id = ?", [discount.batch_id]);

  res.json({
    ok: true,
    data: { id: req.params.id, status: "pending_audit" },
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
