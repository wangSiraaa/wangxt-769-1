const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/", (req, res) => {
  const rows = db.all(`
    SELECT pt.*, d.discount_rate, d.discounted_price, b.product_name, b.sku
    FROM price_tags pt
    JOIN discount_rules d ON pt.discount_id = d.id
    JOIN product_batches b ON d.batch_id = b.id
    ORDER BY pt.created_at DESC
  `);
  res.json({ ok: true, data: rows });
});

module.exports = router;
