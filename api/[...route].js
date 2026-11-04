import { getRequestListener } from "@hono/node-server";
import { app } from "../dist/server.js";

export const config = {
  maxDuration: 60,
};

const listener = getRequestListener(app.fetch);

export default (req, res) => {
  const matchedPath = req.headers["x-matched-path"];
  if (matchedPath && typeof matchedPath === "string" && matchedPath.startsWith("/api")) {
    const qIdx = req.url ? req.url.indexOf("?") : -1;
    req.url = qIdx >= 0 ? `${matchedPath}${req.url.slice(qIdx)}` : matchedPath;
  }
  return listener(req, res);
};
