// ============================================================
// CrowdFund API — Express 5 · Node.js · TypeScript · MongoDB
// ALL SERVER CODE IN THIS SINGLE FILE (Server/index.ts)
// ============================================================

// ============================================================
// 1. IMPORTS & ENV
// ============================================================
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose, { Schema, Document, Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';

dotenv.config(); // MUST be first — loads .env before anything else

// ============================================================
// 2. CONSTANTS
// ============================================================
const PORT                    = process.env.PORT || 8000;
const CREDIT_PURCHASE_RATE    = 10;   // Supporter: $1 = 10 credits
const CREDIT_WITHDRAWAL_RATE  = 20;   // Creator: 20 credits = $1
const MIN_WITHDRAWAL_CREDITS  = 200;  // Minimum credits to withdraw
const SUPPORTER_SIGNUP_CREDITS = 50;
const CREATOR_SIGNUP_CREDITS   = 20;
const BCRYPT_SALT_ROUNDS       = 12;

// ============================================================
// 3. MONGOOSE CONNECTION
// ============================================================
mongoose
  .connect(process.env.MONGODB_URI!)
  .then(() => {
    console.error('✅ MongoDB connected');
  })
  .catch((err: unknown) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ============================================================
// 4. TYPESCRIPT INTERFACES
// (Populated in Phase 2)
// ============================================================

// Global Express Request augmentation — req.user available in all routes
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: 'supporter' | 'creator' | 'admin';
        email: string;
      };
    }
  }
}

// ============================================================
// 5. MONGOOSE MODELS
// (Populated in Phase 2)
// ============================================================

// ============================================================
// 6. EXPRESS APP & MIDDLEWARE
// (Populated in Phase 3)
// ============================================================

// ============================================================
// 7. AUTH MIDDLEWARE (verifyToken, roleGuard, setAuthCookie)
// (Populated in Phase 3)
// ============================================================

// ============================================================
// 8. AUTH ROUTES  (POST /api/auth/register | /login | /logout | GET /me)
// (Populated in Phase 3)
// ============================================================

// ============================================================
// 9. CAMPAIGN ROUTES
// (Populated in Phase 4)
// ============================================================

// ============================================================
// 10. CONTRIBUTION ROUTES
// (Populated in Phase 5)
// ============================================================

// ============================================================
// 11. WITHDRAWAL ROUTES
// (Populated in Phase 6)
// ============================================================

// ============================================================
// 12. CREDIT PURCHASE ROUTES
// (Populated in Phase 6)
// ============================================================

// ============================================================
// 13. USER MANAGEMENT ROUTES (Admin)
// (Populated in Phase 6)
// ============================================================

// ============================================================
// 14. GLOBAL ERROR HANDLER
// (Populated in Phase 6)
// ============================================================

// ============================================================
// 15. SERVER LISTEN
// ============================================================
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'CrowdFund API 🚀' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Server is healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.error(`✅ Server running at http://localhost:${PORT}`);
});