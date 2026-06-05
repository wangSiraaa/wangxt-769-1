const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/", (req, res) => {
  const rows = db.all(`
    SELECT b.*, u.display_name AS creator_name
    FROM product_batches b
    JOIN users u ON b.created_by = u.id
    ORDER BY b.created_at DESC
  `);
  res.json({ ok: true, data: rows });
});

router.post("/", (req, res) => {
  const {
    product_name, sku, cost_price, retail_price,
    production_date, shelf_life_days, min_profit_rate, created_by,
  } = req.body;

  if (!product_name || !sku || !cost_price || !retail_price || !production_date || !shelf_life_days) {
    return res.status(400).json({ ok: false, msg: "缺少必填字段" });
  }

  const profit = min_profit_rate != null ? min_profit_rate : 0.05;
  const prodDate = new Date(production_date);
  const expiryDate = new Date(prodDate.getTime() + shelf_life_days * 86400000);
  const expiryStr = expiryDate.toISOString().slice(0, 10);

  const now = new Date();
  const isExpired = expiryDate <= now;

  const info = db.run(
    `INSERT INTO product_batches
      (product_name, sku, cost_price, retail_price, production_date, shelf_life_days, expiry_date, min_profit_rate, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [product_name, sku, cost_price, retail_price, production_date, shelf_life_days, expiryStr, profit,
     isExpired ? "expired" : "active", created_by || 1]
  );

  if (isExpired) {
    return res.status(201).json({
      ok: true,
      data: { id: info.lastInsertRowid, status: "expired" },
      warning: "该批次已过期，不可参与临期折扣销售",
    });
  }

  res.status(201).json({ ok: true, data: { id: info.lastInsertRowid, status: "active" } });
});

router.get("/:id", (req, res) => {
  const row = db.get(`
    SELECT b.*, u.display_name AS creator_name
    FROM product_batches b
    JOIN users u ON b.created_by = u.id
    WHERE b.id = ?
  `, [req.params.id]);
  if (!row) return res.status(404).json({ ok: false, msg: "批次不存在" });
  res.json({ ok: true, data: row });
});

module.exports = router;
