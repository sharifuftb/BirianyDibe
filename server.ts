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
let db: any = null;

async function getDb() {
  if (db) return db;
  try {
    const { default: Database } = await import("better-sqlite3");
    db = new Database(dbPath);
    console.log(`Database connected at ${dbPath}`);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT, avatar TEXT);
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, user_id TEXT, place_name TEXT, description TEXT,
        lat REAL, lng REAL, distribution_time TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT, user_id TEXT, vote_type INTEGER,
        UNIQUE(post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT, user_id TEXT, reason TEXT
      );
    `);
  } catch (err) {
    console.error('Database initialization failed, using mock:', err);
    db = {
      prepare: (sql: string) => ({
        run: () => ({ lastInsertRowid: 0 }),
        get: () => null,
        all: () => []
      }),
      exec: () => {}
    };
  }
  return db;
}

let appInstance: any = null;
let httpServerInstance: any = null;
let ioInstance: any = null;

// In-memory fallback for serverless environments where DB might fail
let memoryPosts: any[] = [
  {
    id: 'sample-1',
    user_id: 'system',
    user_name: 'এডমিন',
    place_name: 'ঢাকা বিশ্ববিদ্যালয় এলাকা',
    description: 'এখানে নিয়মিত রাতে বিরিয়ানি বিতরণ করা হয়।',
    lat: 23.733,
    lng: 90.393,
    distribution_time: new Date().toISOString(),
    true_votes: 15,
    false_votes: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'sample-2',
    user_id: 'system',
    user_name: 'এডমিন',
    place_name: 'মিরপুর ১০ গোলচত্বর',
    description: 'শুক্রবার জুমার পর এখানে খিচুড়ি পাওয়া যায়।',
    lat: 23.807,
    lng: 90.368,
    distribution_time: new Date().toISOString(),
    true_votes: 8,
    false_votes: 0,
    created_at: new Date().toISOString()
  }
];

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
  app.get("/api/posts", async (req, res) => {
    const database = await getDb();
    try {
      const posts = database.prepare(`
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

  app.post("/api/posts", async (req, res) => {
    const database = await getDb();
    try {
      const { id, user_id, place_name, description, lat, lng, distribution_time } = req.body;
      console.log('Creating post:', { id, place_name });
      
      if (!place_name) {
        return res.status(400).json({ error: 'Place name is required' });
      }

      // Try DB first
      try {
        database.prepare("INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)").run(user_id, "Anonymous User");
        const stmt = database.prepare(`
          INSERT INTO posts (id, user_id, place_name, description, lat, lng, distribution_time)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, user_id, place_name, description, lat, lng, distribution_time);
        
        const newPost = database.prepare(`
          SELECT p.*, u.name as user_name, 0 as true_votes, 0 as false_votes
          FROM posts p
          LEFT JOIN users u ON p.user_id = u.id
          WHERE p.id = ?
        `).get(id);

        if (newPost) {
          if (ioInstance) ioInstance.emit("post:created", newPost);
          return res.status(201).json(newPost);
        }
      } catch (dbErr) {
        console.error('DB Insert failed, falling back to memory:', dbErr);
      }

      // Fallback to memory
      const memPost = {
        id, user_id, place_name, description, lat, lng, distribution_time,
        user_name: "Anonymous User",
        true_votes: 0,
        false_votes: 0,
        created_at: new Date().toISOString()
      };
      memoryPosts.unshift(memPost);
      if (ioInstance) ioInstance.emit("post:created", memPost);
      res.status(201).json(memPost);
    } catch (error) {
      console.error('Critical error creating post:', error);
      res.status(500).json({ error: 'Failed to create post', details: String(error) });
    }
  });

  app.post("/api/votes", async (req, res) => {
    const database = await getDb();
    const { post_id, user_id, vote_type } = req.body;
    console.log(`Vote received: post=${post_id}, user=${user_id}, type=${vote_type}`);
    
    try {
      // Upsert vote
      const stmt = database.prepare(`
        INSERT INTO votes (post_id, user_id, vote_type)
        VALUES (?, ?, ?)
        ON CONFLICT(post_id, user_id) DO UPDATE SET vote_type = excluded.vote_type
      `);
      stmt.run(post_id, user_id, vote_type);

      const stats = database.prepare(`
        SELECT 
          (SELECT COUNT(*) FROM votes WHERE post_id = ? AND vote_type = 1) as true_votes,
          (SELECT COUNT(*) FROM votes WHERE post_id = ? AND vote_type = 0) as false_votes
      `).get(post_id, post_id);

      if (ioInstance) ioInstance.emit("post:voted", { post_id, ...stats });
      res.json({ post_id, ...stats });
    } catch (err) {
      console.error('Vote error:', err);
      res.json({ post_id, true_votes: 0, false_votes: 0 });
    }
  });

  app.post("/api/reports", async (req, res) => {
    const database = await getDb();
    const { post_id, user_id, reason } = req.body;
    try {
      database.prepare("INSERT INTO reports (post_id, user_id, reason) VALUES (?, ?, ?)").run(post_id, user_id, reason);
      res.status(201).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to report' });
    }
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
