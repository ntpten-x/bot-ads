const token = process.env.API_TOKEN;
if (!token) throw new Error("API_TOKEN missing in .env");
try {
  const response = await fetch("http://127.0.0.1:4318/health", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  if (!response.ok || result.status !== "ready") {
    console.error(`Backend not ready (HTTP ${response.status})`);
    process.exitCode = 1;
  } else {
    console.log("Backend and PostgreSQL are ready: http://127.0.0.1:4318");
  }
} catch {
  console.error("Cannot connect to Backend. Start Docker and npm run dev:api.");
  process.exitCode = 1;
}
export {};
