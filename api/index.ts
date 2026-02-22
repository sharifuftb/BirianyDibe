import { startServer } from "../server.js";

export default async (req: any, res: any) => {
  const { app } = await startServer();
  return app(req, res);
};
