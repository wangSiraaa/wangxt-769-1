const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/", (req, res) => {
  const rows = db.all("SELECT * FROM users ORDER BY id");
  res.json({ ok: true, data: rows });
});

router.post("/login", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ ok: false, msg: "缺少 username" });
  const user = db.get("SELECT * FROM users WHERE username = ?", [username]);
  if (!user) return res.status(404).json({ ok: false, msg: "用户不存在" });
  res.json({ ok: true, data: user });
});

module.exports = router;
