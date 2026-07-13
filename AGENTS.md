# AGENTS.md — Server-Side Rules
# CrowdFund API — Express 5 · Node.js · TypeScript · MongoDB
# ⚠️ ALL CODE IN ONE FILE: `Server/index.ts`

---

## 1. The Golden Rule

> **Every single line of server code goes into `Server/index.ts`.**
> No sub-directories. No route files. No model files. No service files.
> One file. Organized with clear section comments.

---

## 2. Stack Versions (Exact)

| Package       | Version  | Notes                                                      |
|---------------|----------|------------------------------------------------------------|
| express       | ^5.2.1   | Async errors auto-propagate — no `next(err)` needed       |
| typescript    | ^7.0.2   | Strict mode ON                                             |
| tsx           | ^4.23.1  | Dev runner (`npm run dev`)                                 |
| mongoose      | install  | ODM for MongoDB                                            |
| jsonwebtoken  | install  | JWT sign/verify                                            |
| bcrypt        | install  | Password hashing (salt rounds: 12)                         |
| cookie-parser | install  | Parse `httpOnly` cookies on incoming requests              |
| cors          | ^2.8.6   | Already installed — configure with `CLIENT_URL`           |
| dotenv        | ^17.4.2  | Already installed — `dotenv.config()` at very top         |

---

## 3. `index.ts` Section Layout

Organize the single file with these clearly labeled sections **in this exact order**:

```typescript
// ============================================================
// 1. IMPORTS & ENV
// ============================================================

// ============================================================
// 2. CONSTANTS (credit rates, signup bonuses, etc.)
// ============================================================

// ============================================================
// 3. MONGOOSE CONNECTION
// ============================================================

// ============================================================
// 4. TYPESCRIPT INTERFACES (User, Campaign, Contribution, etc.)
// ============================================================

// ============================================================
// 5. MONGOOSE MODELS (userModel, campaignModel, etc.)
// ============================================================

// ============================================================
// 6. EXPRESS APP & MIDDLEWARE (cors, json, rateLimiter)
// ============================================================

// ============================================================
// 7. AUTH MIDDLEWARE (verifyToken, roleGuard)
// ============================================================

// ============================================================
// 8. AUTH ROUTES  (POST /api/auth/register | /login | GET /me)
// ============================================================

// ============================================================
// 9. CAMPAIGN ROUTES
// ============================================================

// ============================================================
// 10. CONTRIBUTION ROUTES
// ============================================================

// ============================================================
// 11. WITHDRAWAL ROUTES
// ============================================================

// ============================================================
// 12. CREDIT PURCHASE ROUTES
// ============================================================

// ============================================================
// 13. USER MANAGEMENT ROUTES (Admin)
// ============================================================

// ============================================================
// 14. GLOBAL ERROR HANDLER
// ============================================================

// ============================================================
// 15. SERVER LISTEN
// ============================================================
```

---

## 4. Required Packages to Install

```bash
npm install mongoose jsonwebtoken bcrypt cookie-parser
npm install --save-dev @types/jsonwebtoken @types/bcrypt @types/cookie-parser
```

---

## 5. TypeScript Rules

- `"strict": true` in `tsconfig.json`.
- **Never use `any`**. Use `unknown` + type guards.
- Declare interfaces inside `index.ts` under **Section 4**.
- Augment Express Request at the top level of the file:

```typescript
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: 'supporter' | 'creator' | 'admin'; email: string };
    }
  }
}
```

---

## 6. Constants Block (Section 2)

```typescript
const CREDIT_PURCHASE_RATE    = 10;   // Supporter: $1 = 10 credits
const CREDIT_WITHDRAWAL_RATE  = 20;   // Creator: 20 credits = $1
const MIN_WITHDRAWAL_CREDITS  = 200;  // Minimum credits to withdraw
const SUPPORTER_SIGNUP_CREDITS = 50;
const CREATOR_SIGNUP_CREDITS   = 20;
const BCRYPT_SALT_ROUNDS       = 12;
const JWT_EXPIRES_IN           = '7d';
```

---

## 7. API Response Standard

Every route must respond using this exact shape:

```typescript
// Success
res.status(200).json({ success: true, data: result, message: 'optional' });

// Error
res.status(400).json({ success: false, error: 'Descriptive message' });
```

- Never return raw Mongoose documents — always call `.toObject()`.
- Strip `password` and `__v` from every response.
- Transform `_id` (ObjectId) → `id` (string) in all responses.

---

## 8. Auth Middleware (Section 7)

### Cookie Setup (Section 6 — app middleware)
```typescript
import cookieParser from 'cookie-parser';

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
```

> ⚠️ `credentials: true` on CORS is required for cookies to be sent cross-origin.

### verifyToken — reads from cookie
```typescript
// Place inline in index.ts under Section 7
function verifyToken(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.cf_token;         // httpOnly cookie
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string; role: string; email: string;
    };
    req.user = { id: payload.id, role: payload.role as 'supporter' | 'creator' | 'admin', email: payload.email };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

function roleGuard(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    next();
  };
}
```

### Setting the cookie on login/register
```typescript
// Helper — call this at the end of both /register and /login handlers
function setAuthCookie(res: Response, userId: string, role: string, email: string) {
  const token = jwt.sign(
    { id: userId, role, email },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );
  res.cookie('cf_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days in ms
  });
  return token;
}
```

### Logout route (Section 8)
```typescript
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('cf_token', { httpOnly: true, sameSite: 'lax' });
  res.json({ success: true, message: 'Logged out' });
});
```

---

## 9. Atomicity (Credit Operations)

All credit mutations MUST use MongoDB atomic `$inc` to prevent race conditions:

```typescript
// Deduct credits — guard prevents going below 0
const user = await UserModel.findOneAndUpdate(
  { _id: supporterId, credits: { $gte: amount } },
  { $inc: { credits: -amount } },
  { new: true }
);
if (!user) return res.status(400).json({ success: false, error: 'Insufficient credits' });

// Add to campaign raised_amount + mark contribution approved
await Promise.all([
  ContributionModel.findByIdAndUpdate(id, { status: 'approved' }),
  CampaignModel.findByIdAndUpdate(campaignId, { $inc: { raised_amount: amount } }),
]);
```

---

## 10. Route Naming

All routes use `/api/` prefix:

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout           (clears cookie)
GET    /api/auth/me

GET    /api/campaigns          (public, filterable, paginated)
GET    /api/campaigns/top      (public, top 6 by raised_amount)
GET    /api/campaigns/mine     (Creator — own campaigns)
GET    /api/campaigns/:id      (public)
POST   /api/campaigns          (Creator)
PATCH  /api/campaigns/:id      (Creator — title/story/reward)
DELETE /api/campaigns/:id      (Creator — deletes + bulk refunds)
PATCH  /api/campaigns/:id/status  (Admin — approve/reject)

POST   /api/contributions           (Supporter)
GET    /api/contributions/mine      (Supporter)
GET    /api/contributions/pending   (Creator — pending to review)
PATCH  /api/contributions/:id/approve  (Creator)
PATCH  /api/contributions/:id/reject   (Creator)

POST   /api/withdrawals           (Creator)
GET    /api/withdrawals/mine      (Creator)
GET    /api/withdrawals           (Admin)
PATCH  /api/withdrawals/:id/approve  (Admin)
PATCH  /api/withdrawals/:id/reject   (Admin)

GET    /api/users                 (Admin)
PATCH  /api/users/:id/role        (Admin)
PATCH  /api/users/:id/status      (Admin)

POST   /api/credits/purchase      (Supporter)
GET    /api/credits/history       (Supporter)
```

---

## 11. Environment Variables (`Server/.env`)

```
PORT=8000
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/crowdfund
JWT_SECRET=your_super_secret_jwt_key_min_32_chars
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:3000
```

- Never commit `.env`.
- Always call `dotenv.config()` at the very top of `index.ts` before anything else.
- Access via `process.env.VARIABLE_NAME!` (non-null assertion after validation).

---

## 12. Security Checklist

- [ ] `password` field never returned in any response
- [ ] `__v` stripped from all Mongoose responses
- [ ] JWT stored in `httpOnly` cookie — **never** in localStorage
- [ ] Cookie: `httpOnly: true`, `sameSite: 'lax'`, `secure: true` (prod)
- [ ] CORS: `credentials: true` + only `process.env.CLIENT_URL` origin
- [ ] JWT secret non-null asserted after dotenv load
- [ ] bcrypt salt rounds = 12
- [ ] Role guard applied on all protected routes
- [ ] Atomic `$inc` used for all credit mutations
- [ ] `cookie-parser` middleware registered before route handlers
- [ ] Logout route calls `res.clearCookie('cf_token')`
- [ ] Global error handler as last `app.use()` before `listen`

---

## 13. Git Standards

Use Conventional Commits. Target **12+ notable commits**:

```
feat(server): initial Express 5 setup with dotenv and CORS
feat(db): mongoose connection in index.ts
feat(models): all Mongoose schemas defined in index.ts
feat(auth): register and login endpoints with bcrypt + JWT
feat(middleware): verifyToken and roleGuard inline middleware
feat(campaigns): CRUD routes + admin approve/reject
feat(contributions): create, approve, reject with atomic credits
feat(withdrawals): creator request + admin approval
feat(credits): credit purchase endpoint
feat(users): admin user management routes
feat(server): global error handler and health check
fix(contributions): refund credits on campaign delete
```
