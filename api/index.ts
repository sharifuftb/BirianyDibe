import { startServer } from "../server";

let cachedApp: any = null;

export default async (req: any, res: any) => {
  if (!cachedApp) {
    const { app } = await startServer();
    cachedApp = app;
  }
  return cachedApp(req, res);
};
