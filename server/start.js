import http from "node:http";

const port = Number(process.env.PORT) || 8080;

let requestHandler = (req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(
    JSON.stringify({
      status: "booting",
      message: "Server is initializing...",
      nodeVersion: process.version,
    }),
  );
};

const server = http.createServer((req, res) => {
  requestHandler(req, res);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`HTTP server listening on 0.0.0.0:${port}`);
});

try {
  const { app, startPushScheduler } = await import("./server.js");
  requestHandler = app;
  if (typeof startPushScheduler === "function") {
    startPushScheduler();
  }
  console.log("App mounted successfully");
} catch (err) {
  console.error("FATAL ERROR MOUNTING APP:", err);
  requestHandler = (req, res) => {
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
  };
}
