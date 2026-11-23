import http from "node:http";

const port = Number(process.env.PORT) || 8080;

try {
  const { app, startPushScheduler } = await import("./server.js");
  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
    if (typeof startPushScheduler === "function") {
      startPushScheduler();
    }
  });
} catch (err) {
  console.error("FATAL STARTUP ERROR:", err);
  const server = http.createServer((req, res) => {
    res.writeHead(500, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        status: "fatal_startup_error",
        error: err.message,
        stack: err.stack,
      }),
    );
  });
  server.listen(port, "0.0.0.0");
}
