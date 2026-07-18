import "dotenv/config";
import { createApp } from "./app";

const PORT = Number(process.env.PORT) || 4000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`✅ Hubsell backend đang chạy tại http://localhost:${PORT}`);
  console.log(`   Kiểm tra:  http://localhost:${PORT}/health`);
});
