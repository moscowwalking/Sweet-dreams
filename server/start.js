import http from "node:http";

const port = Number(process.env.PORT) || 8080;

let initError = null;
let appInstance = null;

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  initError = {
    message: err?.message,
    stack: err?.stack,
    type: "uncaughtException",
  };
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
  initError = {
    message: String(reason?.message || reason),
    stack: reason?.stack,
    type: "unhandledRejection",
  };
});

const initPromise = (async () => {
  try {
    const { app, startPushScheduler } = await import("./server.js");
    appInstance = app;
    if (typeof startPushScheduler === "function") {
      startPushScheduler();
    }
    console.log("App mounted successfully");
  } catch (err) {
    console.error("FATAL ERROR MOUNTING APP:", err);
    initError = {
      message: err?.message,
      stack: err?.stack,
      type: "mountError",
    };
  }
})();

const server = http.createServer(async (req, res) => {
  if (!appInstance && !initError) {
    await initPromise;
  }

  if (initError) {
    res.writeHead(500, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        status: "init_error",
        error: initError,
      }),
    );
    return;
  }

  if (appInstance) {
    appInstance(req, res);
    return;
  }

  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "unexpected_server_state" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on 0.0.0.0:${port}`);
});
