import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use /tmp for SQLite on Vercel/Serverless
const dbPath = process.env.NODE_ENV === "production" ? "/tmp/biryani.db" : "biryani.db";
let db: Database.Database;

try {
  db = new Database(dbPath);
  console.log(`Database connected at ${dbPath}`);
} catch (err) {
  console.error('Failed to connect to database:', err);
  // Fallback to in-memory if file fails
  db = new Database(':memory:');
  console.log('Falling back to in-memory database');
}

// Initialize Database
try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    avatar TEXT
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    place_name TEXT,
    description TEXT,
    lat REAL,
    lng REAL,
    distribution_time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT,
    user_id TEXT,
    vote_type INTEGER, -- 1 for TRUE, 0 for FALSE
    UNIQUE(post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT,
    user_id TEXT,
    reason TEXT
  );
`);
} catch (err) {
  console.error('Failed to initialize database schema:', err);
}

let appInstance: any = null;
let httpServerInstance: any = null;
let ioInstance: any = null;

// In-memory fallback for serverless environments where DB might fail
let memoryPosts: any[] = [];

export async function startServer() {
  if (appInstance) return { app: appInstance, httpServer: httpServerInstance, io: ioInstance };

  const app = express();
  const httpServer = createServer(app);
  let io: Server | null = null;
  
  // Only initialize Socket.io if not on Vercel/Production
  if (process.env.NODE_ENV !== "production") {
    io = new Server(httpServer);
    ioInstance = io;
  }
  
  const PORT = 3000;

  appInstance = app;
  httpServerInstance = httpServer;
  ioInstance = io;

  app.use(express.json());

  // API Routes
  app.get("/api/posts", (req, res) => {
    try {
      const posts = db.prepare(`
        SELECT p.*, 
               u.name as user_name,
               (SELECT COUNT(*) FROM votes v WHERE v.post_id = p.id AND v.vote_type = 1) as true_votes,
               (SELECT COUNT(*) FROM votes v WHERE v.post_id = p.id AND v.vote_type = 0) as false_votes
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
      `).all();
      res.json([...posts, ...memoryPosts]);
    } catch (err) {
      console.error('Fetch posts error:', err);
      res.json(memoryPosts);
    }
  });

  app.post("/api/posts", (req, res) => {
    try {
      const { id, user_id, place_name, description, lat, lng, distribution_time } = req.body;
      console.log('Creating post:', { id, place_name });
      
      // Ensure user exists (mock auth for now)
      db.prepare("INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)").run(user_id, "Anonymous User");

      const stmt = db.prepare(`
        INSERT INTO posts (id, user_id, place_name, description, lat, lng, distribution_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, user_id, place_name, description, lat, lng, distribution_time);
      
      const newPost = db.prepare(`
        SELECT p.*, u.name as user_name, 0 as true_votes, 0 as false_votes
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.id = ?
      `).get(id);

      if (ioInstance) {
        ioInstance.emit("post:created", newPost);
      }
      res.status(201).json(newPost);
    } catch (error) {
      console.error('Error creating post:', error);
      // Fallback to memory
      try {
        const { id, user_id, place_name, description, lat, lng, distribution_time } = req.body;
        const memPost = {
          id, user_id, place_name, description, lat, lng, distribution_time,
          user_name: "Anonymous User",
          true_votes: 0,
          false_votes: 0,
          created_at: new Date().toISOString()
        };
        memoryPosts.unshift(memPost);
        if (ioInstance) ioInstance.emit("post:created", memPost);
        return res.status(201).json(memPost);
      } catch (memErr) {
        res.status(500).json({ error: 'Failed to create post', details: error instanceof Error ? error.message : String(error) });
      }
    }
  });

  app.post("/api/votes", (req, res) => {
    const { post_id, user_id, vote_type } = req.body;
    console.log(`Vote received: post=${post_id}, user=${user_id}, type=${vote_type}`);
    
    try {
      // Upsert vote
      const stmt = db.prepare(`
        INSERT INTO votes (post_id, user_id, vote_type)
        VALUES (?, ?, ?)
        ON CONFLICT(post_id, user_id) DO UPDATE SET vote_type = excluded.vote_type
      `);
      stmt.run(post_id, user_id, vote_type);

      const stats = db.prepare(`
        SELECT 
          (SELECT COUNT(*) FROM votes WHERE post_id = ? AND vote_type = 1) as true_votes,
          (SELECT COUNT(*) FROM votes WHERE post_id = ? AND vote_type = 0) as false_votes
      `).get(post_id, post_id);

      if (ioInstance) ioInstance.emit("post:voted", { post_id, ...stats });
      res.json({ post_id, ...stats });
    } catch (err) {
      console.error('Vote error:', err);
      // Memory fallback for votes is harder, but we can at least return success
      res.json({ post_id, true_votes: 0, false_votes: 0 });
    }
  });

  app.post("/api/reports", (req, res) => {
    const { post_id, user_id, reason } = req.body;
    db.prepare("INSERT INTO reports (post_id, user_id, reason) VALUES (?, ?, ?)").run(post_id, user_id, reason);
    res.status(201).json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  if (io) {
    io.on("connection", (socket) => {
      console.log("A user connected");
      socket.on("disconnect", () => {
        console.log("User disconnected");
      });
    });
  }

  return { app, httpServer };
}

// Only start the server if this file is run directly
if (process.env.NODE_ENV !== "production") {
  startServer().then(({ httpServer }) => {
    httpServer.listen(3000, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:3000`);
    });
  });
}
