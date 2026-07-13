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

type UserRole = 'supporter' | 'creator' | 'admin';
type CampaignStatus = 'pending' | 'active' | 'rejected' | 'closed';
type ContributionStatus = 'pending' | 'approved' | 'rejected';
type WithdrawalStatus = 'pending' | 'approved' | 'rejected';
type PaymentSystem = 'stripe' | 'bkash' | 'rocket' | 'nagad';
type CreditPurchaseStatus = 'pending' | 'completed' | 'failed';
type CampaignCategory = 'Technology' | 'Art' | 'Community' | 'Health' | 'Education' | 'Other';

interface IUser extends Document {
  name: string;
  email: string;
  photoURL: string;
  password: string;
  role: UserRole;
  credits: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ICampaign extends Document {
  title: string;
  campaign_story: string;
  category: CampaignCategory;
  funding_goal: number;
  minimum_contribution: number;
  deadline: Date;
  reward_info: string;
  campaign_image_url: string;
  creator_id: Types.ObjectId;
  creator_name: string;
  creator_email: string;
  raised_amount: number;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface IContribution extends Document {
  campaign_id: Types.ObjectId;
  campaign_title: string;
  supporter_id: Types.ObjectId;
  supporter_name: string;
  supporter_email: string;
  amount: number;
  message?: string;
  status: ContributionStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface IWithdrawal extends Document {
  creator_id: Types.ObjectId;
  creator_name: string;
  creator_email: string;
  withdrawal_credit: number;
  withdrawal_amount: number;
  payment_system: PaymentSystem;
  account_number: string;
  withdraw_date: Date;
  status: WithdrawalStatus;
  createdAt: Date;
}

interface ICreditPurchase extends Document {
  user_id: Types.ObjectId;
  user_email: string;
  amount_usd: number;
  credits_received: number;
  payment_method: string;
  payment_intent_id?: string;
  status: CreditPurchaseStatus;
  createdAt: Date;
}

// ============================================================
// 5. MONGOOSE MODELS
// ============================================================

// ── User Model ──────────────────────────────────────────────
const userSchema = new Schema<IUser>(
  {
    name:      { type: String, required: true, trim: true },
    email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
    photoURL:  { type: String, default: '' },
    password:  { type: String, required: true },
    role:      { type: String, enum: ['supporter', 'creator', 'admin'], required: true },
    credits:   { type: Number, default: 0 },
    isActive:  { type: Boolean, default: true },
  },
  { timestamps: true }
);
userSchema.set('toJSON', { virtuals: true });
const UserModel = mongoose.model<IUser>('User', userSchema);


// ── Campaign Model ───────────────────────────────────────────
const campaignSchema = new Schema<ICampaign>(
  {
    title:                { type: String, required: true, trim: true },
    campaign_story:       { type: String, required: true },
    category:             { type: String, enum: ['Technology', 'Art', 'Community', 'Health', 'Education', 'Other'], required: true },
    funding_goal:         { type: Number, required: true, min: 100 },
    minimum_contribution: { type: Number, required: true, min: 1 },
    deadline:             { type: Date, required: true },
    reward_info:          { type: String, required: true },
    campaign_image_url:   { type: String, required: true },
    creator_id:           { type: Schema.Types.ObjectId, ref: 'User', required: true },
    creator_name:         { type: String, required: true },
    creator_email:        { type: String, required: true },
    raised_amount:        { type: Number, default: 0 },
    status:               { type: String, enum: ['pending', 'active', 'rejected', 'closed'], default: 'pending' },
  },
  { timestamps: true }
);
campaignSchema.index({ status: 1, raised_amount: -1 });        // top funded
campaignSchema.index({ creator_id: 1, deadline: -1 });         // my campaigns
campaignSchema.index({ category: 1, status: 1 });              // filter by category
campaignSchema.index({ title: 'text', campaign_story: 'text' }); // full-text search
const CampaignModel = mongoose.model<ICampaign>('Campaign', campaignSchema);

// ── Contribution Model ───────────────────────────────────────
const contributionSchema = new Schema<IContribution>(
  {
    campaign_id:     { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
    campaign_title:  { type: String, required: true },
    supporter_id:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    supporter_name:  { type: String, required: true },
    supporter_email: { type: String, required: true },
    amount:          { type: Number, required: true, min: 1 },
    message:         { type: String, default: '' },
    status:          { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);
contributionSchema.index({ campaign_id: 1, status: 1 });
contributionSchema.index({ supporter_id: 1, createdAt: -1 });
const ContributionModel = mongoose.model<IContribution>('Contribution', contributionSchema);

// ── Withdrawal Model ─────────────────────────────────────────
const withdrawalSchema = new Schema<IWithdrawal>(
  {
    creator_id:        { type: Schema.Types.ObjectId, ref: 'User', required: true },
    creator_name:      { type: String, required: true },
    creator_email:     { type: String, required: true },
    withdrawal_credit: { type: Number, required: true, min: MIN_WITHDRAWAL_CREDITS },
    withdrawal_amount: { type: Number, required: true },
    payment_system:    { type: String, enum: ['stripe', 'bkash', 'rocket', 'nagad'], required: true },
    account_number:    { type: String, required: true },
    withdraw_date:     { type: Date, default: Date.now },
    status:            { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);
withdrawalSchema.index({ creator_id: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1 });
const WithdrawalModel = mongoose.model<IWithdrawal>('Withdrawal', withdrawalSchema);

// ── Credit Purchase Model ────────────────────────────────────
const creditPurchaseSchema = new Schema<ICreditPurchase>(
  {
    user_id:           { type: Schema.Types.ObjectId, ref: 'User', required: true },
    user_email:        { type: String, required: true },
    amount_usd:        { type: Number, required: true, min: 1 },
    credits_received:  { type: Number, required: true },
    payment_method:    { type: String, required: true },
    payment_intent_id: { type: String },
    status:            { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
  },
  { timestamps: true }
);
creditPurchaseSchema.index({ user_id: 1, createdAt: -1 });
const CreditPurchaseModel = mongoose.model<ICreditPurchase>('CreditPurchase', creditPurchaseSchema);

// ============================================================
// 6. EXPRESS APP & MIDDLEWARE
// ============================================================
const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,   // required for httpOnly cookies cross-origin
}));
app.use(express.json());
app.use(cookieParser());

// Health check
app.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'CrowdFund API 🚀' });
});
app.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Server is healthy', timestamp: new Date().toISOString() });
});

// ============================================================
// 7. AUTH MIDDLEWARE (verifyToken, roleGuard, setAuthCookie)
// ============================================================

// ── verifyToken: reads JWT from httpOnly cookie ───────────────
function verifyToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.cf_token as string | undefined;
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      role: UserRole;
      email: string;
    };
    req.user = { id: payload.id, role: payload.role, email: payload.email };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
  }
}

// ── roleGuard: restricts route to specific roles ────────────
function roleGuard(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Access denied. Insufficient permissions.' });
      return;
    }
    next();
  };
}

// ── setAuthCookie: signs JWT and sets httpOnly cookie ────────
function setAuthCookie(res: Response, userId: string, role: UserRole, email: string): void {
  const token = jwt.sign(
    { id: userId, role, email },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );
  res.cookie('cf_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  });
}

// ── stripUser: removes password and __v from user doc ───────
function stripUser(user: IUser & { _id: Types.ObjectId }) {
  const obj = user.toObject();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, __v, _id, ...rest } = obj as Record<string, unknown>;
  return { id: (_id as Types.ObjectId).toString(), ...rest };
}

// ============================================================
// 8. AUTH ROUTES  (POST /api/auth/register | /login | /logout | GET /me)
// ============================================================

// ── POST /api/auth/register ────────────────────────────
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { name, email, password, role, photoURL } = req.body as {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    photoURL?: string;
  };

  if (!name || !email || !password || !role) {
    res.status(400).json({ success: false, error: 'Name, email, password, and role are required.' });
    return;
  }
  if (!['supporter', 'creator'].includes(role)) {
    res.status(400).json({ success: false, error: 'Role must be supporter or creator.' });
    return;
  }

  const existing = await UserModel.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    return;
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const credits = role === 'supporter' ? SUPPORTER_SIGNUP_CREDITS : CREATOR_SIGNUP_CREDITS;

  const user = await UserModel.create({
    name,
    email,
    password: hashedPassword,
    role,
    photoURL: photoURL || '',
    credits,
  });

  setAuthCookie(res, (user._id as Types.ObjectId).toString(), user.role, user.email);
  res.status(201).json({ success: true, data: stripUser(user), message: 'Account created successfully.' });
});

// ── POST /api/auth/login ───────────────────────────────
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };

  if (!email || !password) {
    res.status(400).json({ success: false, error: 'Email and password are required.' });
    return;
  }

  const user = await UserModel.findOne({ email: email.toLowerCase() });
  if (!user) {
    res.status(401).json({ success: false, error: 'Invalid email or password.' });
    return;
  }

  if (!user.isActive) {
    res.status(403).json({ success: false, error: 'Your account has been deactivated. Contact support.' });
    return;
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    res.status(401).json({ success: false, error: 'Invalid email or password.' });
    return;
  }

  setAuthCookie(res, (user._id as Types.ObjectId).toString(), user.role, user.email);
  res.json({ success: true, data: stripUser(user), message: 'Logged in successfully.' });
});

// ── POST /api/auth/logout ─────────────────────────────
app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('cf_token', { httpOnly: true, sameSite: 'lax' });
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ── GET /api/auth/me ─────────────────────────────────
app.get('/api/auth/me', verifyToken, async (req: Request, res: Response) => {
  const user = await UserModel.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found.' });
    return;
  }
  res.json({ success: true, data: stripUser(user) });
});

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
app.listen(PORT, () => {
  console.error(`✅ CrowdFund server running at http://localhost:${PORT}`);
});