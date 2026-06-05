const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

async function start() {
  await initDb();

  app.use("/api/users", require("./routes/users"));
  app.use("/api/batches", require("./routes/batches"));
  app.use("/api/discounts", require("./routes/discounts"));
  app.use("/api/tags", require("./routes/tags"));

  const buildDir = path.join(__dirname, "..", "..", "frontend", "build");
  app.use(express.static(buildDir));

  app.get("*", (req, res) => {
    if (!req.path.startsWith("/api")) {
      return res.sendFile(path.join(buildDir, "index.html"));
    }
    res.status(404).json({ ok: false, msg: "API not found" });
  });

  app.listen(PORT, () => {
    console.log(`Fresh Discount API running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
