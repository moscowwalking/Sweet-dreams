import http from "node:http";

try {
  await import("./server.js");
} catch (err) {
  console.error("FATAL STARTUP ERROR:", err);
  const port = process.env.PORT || 8080;
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
  server.listen(port, "0.0.0.0", () => {
    console.log(`Diagnostic server listening on port ${port}`);
  });
}
