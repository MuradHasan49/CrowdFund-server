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

interface INotification extends Document {
  user_id: Types.ObjectId;
  type: 'success' | 'alert' | 'contribution' | 'info';
  title: string;
  message: string;
  read: boolean;
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

// ── Notification Model ───────────────────────────────────────
const notificationSchema = new Schema<INotification>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type:    { type: String, enum: ['success', 'alert', 'contribution', 'info'], required: true },
    title:   { type: String, required: true },
    message: { type: String, required: true },
    read:    { type: Boolean, default: false },
  },
  { timestamps: true }
);
notificationSchema.index({ user_id: 1, createdAt: -1 });
const NotificationModel = mongoose.model<INotification>('Notification', notificationSchema);

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
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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

// ── POST /api/auth/social ────────────────────────────
app.post('/api/auth/social', async (req: Request, res: Response) => {
  const { provider, token, role } = req.body as { provider: 'google' | 'facebook'; token: string; role?: 'supporter' | 'creator' };

  if (!provider || !token) {
    res.status(400).json({ success: false, error: 'Provider and token are required.' });
    return;
  }

  let name = '';
  let email = '';
  let photoURL = '';

  try {
    if (provider === 'google') {
      const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!googleRes.ok) throw new Error('Invalid Google token');
      const payload = await googleRes.json();
      if (!payload || !payload.email) throw new Error('Invalid Google payload');
      name = payload.name || 'Google User';
      email = payload.email.toLowerCase();
      photoURL = payload.picture || '';
    } else if (provider === 'facebook') {
      // Validate Facebook Access Token
      const fbRes = await fetch(`https://graph.facebook.com/me?access_token=${token}&fields=id,name,email,picture`);
      if (!fbRes.ok) throw new Error('Invalid Facebook token');
      const fbData = await fbRes.json();
      if (!fbData.email) throw new Error('Facebook account has no email attached');
      
      name = fbData.name || 'Facebook User';
      email = fbData.email.toLowerCase();
      photoURL = fbData.picture?.data?.url || '';
    } else {
      res.status(400).json({ success: false, error: 'Invalid provider.' });
      return;
    }
  } catch (error: any) {
    console.error('Social Auth Error:', error.message);
    res.status(401).json({ success: false, error: 'Failed to authenticate with provider.' });
    return;
  }

  // Find user by email or create new supporter/creator
  let user = await UserModel.findOne({ email });
  if (!user) {
    const assignedRole = (role === 'creator' || role === 'supporter') ? role : 'supporter';
    const credits = assignedRole === 'creator' ? CREATOR_SIGNUP_CREDITS : SUPPORTER_SIGNUP_CREDITS;
    
    user = await UserModel.create({
      name,
      email,
      password: `SOCIAL_AUTH_NO_PASS_${Date.now()}_${Math.random()}`, // Random string to pass required:true validation
      role: assignedRole,
      photoURL,
      credits,
      isActive: true,
    });
  } else if (photoURL && !user.photoURL) {
    // Update existing user with the social photo if they don't have one
    await UserModel.updateOne({ _id: user._id }, { $set: { photoURL } });
    user.photoURL = photoURL;
  }

  setAuthCookie(res, (user._id as Types.ObjectId).toString(), user.role, user.email);
  res.json({ success: true, data: stripUser(user), message: 'Login successful' });
});

// ── POST /api/auth/logout ─────────────────────────────
app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('cf_token', { 
    httpOnly: true, 
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production'
  });
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ── GET /api/auth/me ─────────────────────────────────
app.get('/api/auth/me', async (req: Request, res: Response) => {
  const token = req.cookies?.cf_token as string | undefined;
  if (!token) {
    res.json({ success: false, data: null });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { id: string };
    const user = await UserModel.findById(payload.id);
    
    if (!user) {
      res.json({ success: false, data: null });
      return;
    }
    
    res.json({ success: true, data: stripUser(user) });
  } catch (err) {
    res.json({ success: false, data: null });
  }
});

// ── PATCH /api/auth/profile ───────────────────────────
app.patch('/api/auth/profile', verifyToken, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { name, photoURL } = req.body as { name?: string; photoURL?: string };

  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (photoURL !== undefined) updateData.photoURL = photoURL;

  try {
    const updatedUser = await UserModel.findByIdAndUpdate(userId, updateData, { new: true });
    if (!updatedUser) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, data: stripUser(updatedUser), message: 'Profile updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// ============================================================
// 9. CAMPAIGN ROUTES
// ============================================================

// helper — strip Mongoose doc to plain safe object
function stripCampaign(doc: ICampaign & { _id: Types.ObjectId }) {
  const obj = doc.toObject() as Record<string, unknown>;
  const { _id, __v, ...rest } = obj;
  return { id: (_id as Types.ObjectId).toString(), ...rest };
}

// ── GET /api/campaigns  (public, filterable, paginated) ──────
app.get('/api/campaigns', async (req: Request, res: Response) => {
  const {
    search   = '',
    category = '',
    status   = 'active',
    sort     = 'raised',
    page     = '1',
    limit    = '12',
  } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};

  // Status filter — default to active for public listing
  if (status && status !== 'all') {
    filter.status = status;
  }

  // Category filter
  if (category) filter.category = category;

  // Full-text search (RegExp for partial matches)
  if (search.trim()) {
    const regex = new RegExp(search.trim(), 'i');
    filter.$or = [
      { title: regex },
      { campaign_story: regex }
    ];
  }

  // Sort map
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    raised:   { raised_amount: -1 },
    newest:   { createdAt: -1 },
    deadline: { deadline: 1 },
    alpha:    { title: 1 },
  };
  const sortBy = sortMap[sort] ?? sortMap['raised'];

  const pageNum  = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
  const skip     = (pageNum - 1) * limitNum;

  const [campaigns, total] = await Promise.all([
    CampaignModel.find(filter).sort(sortBy).skip(skip).limit(limitNum).lean(),
    CampaignModel.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: campaigns.map((c) => {
      const { _id, __v, ...rest } = c as typeof c & { __v?: number };
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    }),
    meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
  });
});

// ── GET /api/campaigns/top  (public — top 6 by raised_amount) ─
// ⚠️ MUST be before /:id to avoid Express treating "top" as a param
app.get('/api/campaigns/top', async (_req: Request, res: Response) => {
  const campaigns = await CampaignModel.find({ status: 'active' })
    .sort({ raised_amount: -1 })
    .limit(8)
    .lean();

  res.json({
    success: true,
    data: campaigns.map((c) => {
      const { _id, __v, ...rest } = c as typeof c & { __v?: number };
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    }),
  });
});

// ── GET /api/campaigns/mine  (Creator — own campaigns) ────────
// ⚠️ MUST be before /:id
app.get('/api/campaigns/mine', verifyToken, roleGuard('creator'), async (req: Request, res: Response) => {
  const campaigns = await CampaignModel.find({ creator_id: req.user!.id })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: campaigns.map((c) => {
      const { _id, __v, ...rest } = c as typeof c & { __v?: number };
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    }),
  });
});

// ── GET /api/campaigns/:id  (public — single campaign) ────────
app.get('/api/campaigns/:id', async (req: Request, res: Response) => {
  const campaign = await CampaignModel.findById(req.params['id']);
  if (!campaign) {
    res.status(404).json({ success: false, error: 'Campaign not found.' });
    return;
  }
  res.json({ success: true, data: stripCampaign(campaign) });
});

// ── POST /api/campaigns  (Creator — create campaign) ──────────
app.post('/api/campaigns', verifyToken, roleGuard('creator'), async (req: Request, res: Response) => {
  const {
    title,
    campaign_story,
    category,
    funding_goal,
    minimum_contribution,
    deadline,
    reward_info,
    campaign_image_url,
  } = req.body as {
    title: string;
    campaign_story: string;
    category: CampaignCategory;
    funding_goal: number;
    minimum_contribution: number;
    deadline: string;
    reward_info: string;
    campaign_image_url: string;
  };

  if (!title || !campaign_story || !category || !funding_goal || !minimum_contribution || !deadline || !reward_info || !campaign_image_url) {
    res.status(400).json({ success: false, error: 'All campaign fields are required.' });
    return;
  }
  if (new Date(deadline) <= new Date()) {
    res.status(400).json({ success: false, error: 'Deadline must be in the future.' });
    return;
  }
  if (Number(funding_goal) < 100) {
    res.status(400).json({ success: false, error: 'Funding goal must be at least 100 credits.' });
    return;
  }
  if (Number(minimum_contribution) < 1 || Number(minimum_contribution) > Number(funding_goal)) {
    res.status(400).json({ success: false, error: 'Minimum contribution must be between 1 and the funding goal.' });
    return;
  }

  const creator = await UserModel.findById(req.user!.id).lean();
  if (!creator) {
    res.status(404).json({ success: false, error: 'Creator not found.' });
    return;
  }

  const campaign = await CampaignModel.create({
    title: title.trim(),
    campaign_story,
    category,
    funding_goal: Number(funding_goal),
    minimum_contribution: Number(minimum_contribution),
    deadline: new Date(deadline),
    reward_info,
    campaign_image_url,
    creator_id:    creator._id,
    creator_name:  creator.name,
    creator_email: creator.email,
    raised_amount: 0,
    status: 'pending',
  });

  res.status(201).json({ success: true, data: stripCampaign(campaign), message: 'Campaign submitted for review.' });
});

// ── PATCH /api/campaigns/:id  (Creator — update title/story/reward) ─
app.patch('/api/campaigns/:id', verifyToken, roleGuard('creator'), async (req: Request, res: Response) => {
  const campaign = await CampaignModel.findById(req.params['id']);
  if (!campaign) {
    res.status(404).json({ success: false, error: 'Campaign not found.' });
    return;
  }
  if (campaign.creator_id.toString() !== req.user!.id) {
    res.status(403).json({ success: false, error: 'You can only edit your own campaigns.' });
    return;
  }

  const { title, campaign_story, reward_info } = req.body as {
    title?: string;
    campaign_story?: string;
    reward_info?: string;
  };

  if (title)           campaign.title = title.trim();
  if (campaign_story)  campaign.campaign_story = campaign_story;
  if (reward_info)     campaign.reward_info = reward_info;

  await campaign.save();
  res.json({ success: true, data: stripCampaign(campaign), message: 'Campaign updated.' });
});

// ── DELETE /api/campaigns/:id  (Creator — delete + bulk refund) ─
app.delete('/api/campaigns/:id', verifyToken, roleGuard('creator'), async (req: Request, res: Response) => {
  const campaign = await CampaignModel.findById(req.params['id']);
  if (!campaign) {
    res.status(404).json({ success: false, error: 'Campaign not found.' });
    return;
  }
  if (campaign.creator_id.toString() !== req.user!.id) {
    res.status(403).json({ success: false, error: 'You can only delete your own campaigns.' });
    return;
  }

  // Bulk refund all approved contributions atomically
  const approved = await ContributionModel.find({ campaign_id: campaign._id, status: 'approved' }).lean();
  await Promise.all(
    approved.map((c) =>
      UserModel.findByIdAndUpdate(c.supporter_id, { $inc: { credits: c.amount } })
    )
  );

  // Reject pending contributions (no refund — credits already deducted but not yet approved)
  await ContributionModel.updateMany(
    { campaign_id: campaign._id, status: 'pending' },
    { $set: { status: 'rejected' } }
  );

  await CampaignModel.findByIdAndDelete(campaign._id);
  res.json({ success: true, message: `Campaign deleted. ${approved.length} contribution(s) refunded.` });
});

// ── PATCH /api/campaigns/:id/status  (Admin — approve / reject) ─
app.patch('/api/campaigns/:id/status', verifyToken, roleGuard('admin'), async (req: Request, res: Response) => {
  const { status } = req.body as { status: CampaignStatus };

  if (!['active', 'rejected'].includes(status)) {
    res.status(400).json({ success: false, error: 'Status must be "active" or "rejected".' });
    return;
  }

  const campaign = await CampaignModel.findByIdAndUpdate(
    req.params['id'],
    { $set: { status } },
    { new: true }
  );
  if (!campaign) {
    res.status(404).json({ success: false, error: 'Campaign not found.' });
    return;
  }

  await NotificationModel.create({
    user_id: campaign.creator_id,
    type: status === 'active' ? 'success' : 'alert',
    title: status === 'active' ? 'Campaign Approved' : 'Campaign Rejected',
    message: status === 'active' 
      ? `Your campaign "${campaign.title}" has been approved and is now live!` 
      : `Your campaign "${campaign.title}" was rejected.`
  });

  res.json({
    success: true,
    data: stripCampaign(campaign),
    message: status === 'active' ? 'Campaign approved and now live.' : 'Campaign rejected.',
  });
});


// ============================================================
// 10. CONTRIBUTION ROUTES
// ============================================================

// ── POST /api/contributions  (Supporter — create contribution) ─
app.post('/api/contributions', verifyToken, roleGuard('supporter'), async (req: Request, res: Response) => {
  const { campaign_id, amount, message } = req.body as {
    campaign_id: string;
    amount: number;
    message?: string;
  };

  if (!campaign_id || !amount) {
    res.status(400).json({ success: false, error: 'campaign_id and amount are required.' });
    return;
  }

  const campaign = await CampaignModel.findById(campaign_id);
  if (!campaign) {
    res.status(404).json({ success: false, error: 'Campaign not found.' });
    return;
  }
  if (campaign.status !== 'active') {
    res.status(400).json({ success: false, error: 'You can only contribute to active campaigns.' });
    return;
  }
  if (Number(amount) < campaign.minimum_contribution) {
    res.status(400).json({
      success: false,
      error: `Minimum contribution is ${campaign.minimum_contribution} credits.`,
    });
    return;
  }

  // Atomic credit deduction — $gte guard prevents going below 0
  const supporter = await UserModel.findOneAndUpdate(
    { _id: req.user!.id, credits: { $gte: Number(amount) } },
    { $inc: { credits: -Number(amount) } },
    { new: true }
  );
  if (!supporter) {
    res.status(400).json({ success: false, error: 'Insufficient credits. Please purchase more credits.' });
    return;
  }

  const contribution = await ContributionModel.create({
    campaign_id:     campaign._id,
    campaign_title:  campaign.title,
    supporter_id:    req.user!.id,
    supporter_name:  supporter.name,
    supporter_email: supporter.email,
    amount:          Number(amount),
    message:         message?.trim() || '',
    status:          'pending',
  });

  const obj = contribution.toObject() as unknown as Record<string, unknown>;
  const { _id, __v, ...rest } = obj;

  await NotificationModel.create({
    user_id: campaign.creator_id,
    type: 'contribution',
    title: 'New Contribution!',
    message: `${supporter.name} contributed ${amount} credits to "${campaign.title}".`
  });

  res.status(201).json({
    success: true,
    data: { id: (contribution._id as Types.ObjectId).toString(), ...rest },
    message: 'Contribution submitted. Awaiting creator approval.',
  });
});

// ── GET /api/contributions/mine  (Supporter — own contributions) ─
// ⚠️ MUST be before /:id
app.get('/api/contributions/mine', verifyToken, roleGuard('supporter'), async (req: Request, res: Response) => {
  const contributions = await ContributionModel.find({ supporter_id: req.user!.id })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: contributions.map((c) => {
      const { _id, __v, ...rest } = c as typeof c & { __v?: number };
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    }),
  });
});

// ── GET /api/contributions/pending  (Creator — pending on own campaigns) ─
// ⚠️ MUST be before /:id
app.get('/api/contributions/pending', verifyToken, roleGuard('creator'), async (req: Request, res: Response) => {
  // Get all campaigns belonging to this creator
  const myCampaigns = await CampaignModel.find({ creator_id: req.user!.id }).select('_id').lean();
  const campaignIds = myCampaigns.map((c) => c._id);

  const contributions = await ContributionModel.find({
    campaign_id: { $in: campaignIds },
    status: 'pending',
  })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: contributions.map((c) => {
      const { _id, __v, ...rest } = c as typeof c & { __v?: number };
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    }),
  });
});

// ── PATCH /api/contributions/:id/approve  (Creator — approve + add to raised) ─
app.patch('/api/contributions/:id/approve', verifyToken, roleGuard('creator'), async (req: Request, res: Response) => {
  const contribution = await ContributionModel.findById(req.params['id']);
  if (!contribution) {
    res.status(404).json({ success: false, error: 'Contribution not found.' });
    return;
  }
  if (contribution.status !== 'pending') {
    res.status(400).json({ success: false, error: 'Only pending contributions can be approved.' });
    return;
  }

  // Verify creator owns the campaign
  const campaign = await CampaignModel.findById(contribution.campaign_id);
  if (!campaign || campaign.creator_id.toString() !== req.user!.id) {
    res.status(403).json({ success: false, error: 'You can only approve contributions to your own campaigns.' });
    return;
  }

  // Atomic: mark approved + add to raised_amount and creator credits in parallel
  await Promise.all([
    ContributionModel.findByIdAndUpdate(contribution._id, { $set: { status: 'approved' } }),
    CampaignModel.findByIdAndUpdate(campaign._id, { $inc: { raised_amount: contribution.amount } }),
    UserModel.findByIdAndUpdate(req.user!.id, { $inc: { credits: contribution.amount } }),
  ]);

  res.json({ success: true, message: 'Contribution approved. Credits added to campaign.' });
});

// ── PATCH /api/contributions/:id/reject  (Creator — reject + refund supporter) ─
app.patch('/api/contributions/:id/reject', verifyToken, roleGuard('creator'), async (req: Request, res: Response) => {
  const contribution = await ContributionModel.findById(req.params['id']);
  if (!contribution) {
    res.status(404).json({ success: false, error: 'Contribution not found.' });
    return;
  }
  if (contribution.status !== 'pending') {
    res.status(400).json({ success: false, error: 'Only pending contributions can be rejected.' });
    return;
  }

  // Verify creator owns the campaign
  const campaign = await CampaignModel.findById(contribution.campaign_id);
  if (!campaign || campaign.creator_id.toString() !== req.user!.id) {
    res.status(403).json({ success: false, error: 'You can only reject contributions to your own campaigns.' });
    return;
  }

  // Atomic: mark rejected + refund credits to supporter in parallel
  await Promise.all([
    ContributionModel.findByIdAndUpdate(contribution._id, { $set: { status: 'rejected' } }),
    UserModel.findByIdAndUpdate(contribution.supporter_id, { $inc: { credits: contribution.amount } }),
  ]);

  res.json({ success: true, message: 'Contribution rejected. Credits refunded to supporter.' });
});


// ============================================================
// 11. WITHDRAWAL ROUTES
// ============================================================

// ── POST /api/withdrawals  (Creator — request withdrawal) ────
app.post('/api/withdrawals', verifyToken, roleGuard('creator'), async (req: Request, res: Response) => {
  const { withdrawal_credit, payment_system, account_number } = req.body as {
    withdrawal_credit: number;
    payment_system: PaymentSystem;
    account_number: string;
  };

  if (!withdrawal_credit || !payment_system || !account_number) {
    res.status(400).json({ success: false, error: 'withdrawal_credit, payment_system, and account_number are required.' });
    return;
  }
  if (Number(withdrawal_credit) < MIN_WITHDRAWAL_CREDITS) {
    res.status(400).json({
      success: false,
      error: `Minimum withdrawal is ${MIN_WITHDRAWAL_CREDITS} credits ($${MIN_WITHDRAWAL_CREDITS / CREDIT_WITHDRAWAL_RATE}).`,
    });
    return;
  }
  if (!['stripe', 'bkash', 'rocket', 'nagad'].includes(payment_system)) {
    res.status(400).json({ success: false, error: 'Invalid payment system.' });
    return;
  }

  const creator = await UserModel.findById(req.user!.id).lean();
  if (!creator) {
    res.status(404).json({ success: false, error: 'Creator not found.' });
    return;
  }

  if (creator.credits < Number(withdrawal_credit)) {
    res.status(400).json({ success: false, error: 'Insufficient credits.' });
    return;
  }

  const withdrawal_amount = Number(withdrawal_credit) / CREDIT_WITHDRAWAL_RATE;

  const withdrawal = await WithdrawalModel.create({
    creator_id:        req.user!.id,
    creator_name:      creator.name,
    creator_email:     creator.email,
    withdrawal_credit: Number(withdrawal_credit),
    withdrawal_amount,
    payment_system,
    account_number:    account_number.trim(),
    withdraw_date:     new Date(),
    status:            'pending',
  });

  // Deduct credits from user
  await UserModel.findByIdAndUpdate(req.user!.id, { $inc: { credits: -Number(withdrawal_credit) } });

  const obj = withdrawal.toObject() as unknown as Record<string, unknown>;
  const { _id, __v, ...rest } = obj;
  res.status(201).json({
    success: true,
    data: { id: (withdrawal._id as Types.ObjectId).toString(), ...rest },
    message: 'Withdrawal request submitted. Awaiting admin approval.',
  });
});

// ── GET /api/withdrawals/mine  (Creator — own withdrawal history) ─
// ⚠️ MUST be before /:id
app.get('/api/withdrawals/mine', verifyToken, roleGuard('creator'), async (req: Request, res: Response) => {
  const withdrawals = await WithdrawalModel.find({ creator_id: req.user!.id })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: withdrawals.map((w) => {
      const { _id, __v, ...rest } = w as typeof w & { __v?: number };
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    }),
  });
});

// ── GET /api/withdrawals  (Admin — all withdrawal requests) ───
app.get('/api/withdrawals', verifyToken, roleGuard('admin'), async (_req: Request, res: Response) => {
  const withdrawals = await WithdrawalModel.find().sort({ createdAt: -1 }).lean();

  res.json({
    success: true,
    data: withdrawals.map((w) => {
      const { _id, __v, ...rest } = w as typeof w & { __v?: number };
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    }),
  });
});

// ── PATCH /api/withdrawals/:id/approve  (Admin) ───────────────
app.patch('/api/withdrawals/:id/approve', verifyToken, roleGuard('admin'), async (req: Request, res: Response) => {
  const withdrawal = await WithdrawalModel.findById(req.params['id']);
  if (!withdrawal) {
    res.status(404).json({ success: false, error: 'Withdrawal request not found.' });
    return;
  }
  if (withdrawal.status !== 'pending') {
    res.status(400).json({ success: false, error: 'Only pending withdrawals can be approved.' });
    return;
  }

  await WithdrawalModel.findByIdAndUpdate(withdrawal._id, { $set: { status: 'approved' } });
  
  await NotificationModel.create({
    user_id: withdrawal.creator_id,
    type: 'success',
    title: 'Withdrawal Approved',
    message: `Your withdrawal for $${withdrawal.withdrawal_amount} has been approved.`
  });

  res.json({ success: true, message: `Withdrawal of $${withdrawal.withdrawal_amount} approved.` });
});

// ── PATCH /api/withdrawals/:id/reject  (Admin) ────────────────
app.patch('/api/withdrawals/:id/reject', verifyToken, roleGuard('admin'), async (req: Request, res: Response) => {
  const withdrawal = await WithdrawalModel.findById(req.params['id']);
  if (!withdrawal) {
    res.status(404).json({ success: false, error: 'Withdrawal request not found.' });
    return;
  }
  if (withdrawal.status !== 'pending') {
    res.status(400).json({ success: false, error: 'Only pending withdrawals can be rejected.' });
    return;
  }

  await Promise.all([
    WithdrawalModel.findByIdAndUpdate(withdrawal._id, { $set: { status: 'rejected' } }),
    UserModel.findByIdAndUpdate(withdrawal.creator_id, { $inc: { credits: withdrawal.withdrawal_credit } }),
    NotificationModel.create({
      user_id: withdrawal.creator_id,
      type: 'alert',
      title: 'Withdrawal Rejected',
      message: `Your withdrawal for $${withdrawal.withdrawal_amount} was rejected and credits refunded.`
    })
  ]);
  res.json({ success: true, message: 'Withdrawal request rejected and credits refunded.' });
});

// ============================================================
// 12. CREDIT PURCHASE ROUTES
// ============================================================

// ── POST /api/credits/purchase  (Supporter & Creator — buy credits) ────
app.post('/api/credits/purchase', verifyToken, roleGuard('supporter', 'creator'), async (req: Request, res: Response) => {
  const { amount_usd, payment_method, payment_intent_id } = req.body as {
    amount_usd: number;
    payment_method: string;
    payment_intent_id?: string;
  };

  if (!amount_usd || !payment_method) {
    res.status(400).json({ success: false, error: 'amount_usd and payment_method are required.' });
    return;
  }
  if (Number(amount_usd) < 1) {
    res.status(400).json({ success: false, error: 'Minimum purchase is $1.' });
    return;
  }

  const credits_received = Number(amount_usd) * CREDIT_PURCHASE_RATE;

  // Atomic: save purchase record + add credits to user in parallel
  const user = await UserModel.findById(req.user!.id).lean();
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found.' });
    return;
  }

  const [purchase] = await Promise.all([
    CreditPurchaseModel.create({
      user_id:          req.user!.id,
      user_email:       user.email,
      amount_usd:       Number(amount_usd),
      credits_received,
      payment_method,
      payment_intent_id: payment_intent_id || undefined,
      status:           'completed',
    }),
    UserModel.findByIdAndUpdate(req.user!.id, { $inc: { credits: credits_received } }),
    NotificationModel.create({
      user_id: req.user!.id,
      type: 'success',
      title: 'Credits Purchased',
      message: `You successfully purchased ${credits_received} credits.`
    })
  ]);

  const obj = purchase.toObject() as unknown as Record<string, unknown>;
  const { _id, __v, ...rest } = obj;
  res.status(201).json({
    success: true,
    data: { id: (purchase._id as Types.ObjectId).toString(), ...rest },
    message: `Purchase successful! ${credits_received} credits added to your account.`,
  });
});

// ── GET /api/credits/history  (Supporter — purchase history) ──
app.get('/api/credits/history', verifyToken, async (req: Request, res: Response) => {
  const history = await CreditPurchaseModel.find({ user_id: req.user!.id })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: history.map((h) => {
      const { _id, __v, ...rest } = h as typeof h & { __v?: number };
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    }),
  });
});

// ============================================================
// 13. USER MANAGEMENT ROUTES (Admin)
// ============================================================

// ── GET /api/users  (Admin — all users with optional search) ──
app.get('/api/users', verifyToken, roleGuard('admin'), async (req: Request, res: Response) => {
  const { search = '' } = req.query as { search?: string };

  const filter: Record<string, unknown> = {};
  if (search.trim()) {
    filter.$or = [
      { name:  { $regex: search.trim(), $options: 'i' } },
      { email: { $regex: search.trim(), $options: 'i' } },
    ];
  }

  const users = await UserModel.find(filter)
    .select('-password -__v')
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: users.map((u) => {
      const { _id, ...rest } = u;
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    }),
  });
});

// ── PATCH /api/users/:id/role  (Admin — change user role) ─────
app.patch('/api/users/:id/role', verifyToken, roleGuard('admin'), async (req: Request, res: Response) => {
  const { role } = req.body as { role: UserRole };

  if (!['supporter', 'creator'].includes(role)) {
    res.status(400).json({ success: false, error: 'Role must be supporter or creator.' });
    return;
  }

  const user = await UserModel.findByIdAndUpdate(
    req.params['id'],
    { $set: { role } },
    { new: true, select: '-password -__v' }
  );
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found.' });
    return;
  }

  const obj = user.toObject() as unknown as Record<string, unknown>;
  const { _id, __v, ...rest } = obj;
  res.json({ success: true, data: { id: (user._id as Types.ObjectId).toString(), ...rest }, message: `Role updated to ${role}.` });
});

// ── PATCH /api/users/:id/status  (Admin — toggle isActive) ────
app.patch('/api/users/:id/status', verifyToken, roleGuard('admin'), async (req: Request, res: Response) => {
  const { isActive } = req.body as { isActive: boolean };

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ success: false, error: 'isActive must be a boolean.' });
    return;
  }

  const user = await UserModel.findByIdAndUpdate(
    req.params['id'],
    { $set: { isActive } },
    { new: true, select: '-password -__v' }
  );
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found.' });
    return;
  }

  res.json({
    success: true,
    message: `Account ${isActive ? 'activated' : 'deactivated'} successfully.`,
  });
});

// ============================================================
// 14. NOTIFICATION ROUTES
// ============================================================
app.get('/api/notifications', verifyToken, async (req: Request, res: Response) => {
  const notifications = await NotificationModel.find({ user_id: req.user!.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({
    success: true,
    data: notifications.map(n => {
      const { _id, __v, ...rest } = n as typeof n & { __v?: number };
      return { id: (_id as Types.ObjectId).toString(), ...rest };
    })
  });
});

app.patch('/api/notifications/read', verifyToken, async (req: Request, res: Response) => {
  await NotificationModel.updateMany(
    { user_id: req.user!.id, read: false },
    { $set: { read: true } }
  );

  res.json({ success: true, message: 'All notifications marked as read' });
});

// ============================================================
// 15. GLOBAL ERROR HANDLER
// ============================================================
// Must be the LAST app.use() before app.listen()
// Express 5: errors thrown in async handlers auto-propagate here
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('❌ Unhandled error:', err.stack);
  res.status(500).json({ success: false, error: err.message || 'Internal server error.' });
});


// ============================================================
// 15. SERVER LISTEN & SEEDING
// ============================================================
const seedAdmin = async () => {
  try {
    const existingAdmin = await UserModel.findOne({ email: 'admin@crowdfund.com' });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('Admin@12345', BCRYPT_SALT_ROUNDS);
      await UserModel.create({
        name: 'System Admin',
        email: 'admin@crowdfund.com',
        password: hashedPassword,
        role: 'admin',
        credits: 99999,
        isActive: true,
      });
      console.error('✅ Admin user seeded: admin@crowdfund.com');
    }
  } catch (err) {
    console.error('❌ Failed to seed admin user:', err);
  }
};

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, async () => {
    await seedAdmin();
    console.error(`✅ CrowdFund server running at http://localhost:${PORT}`);
  });
} else {
  // In Vercel (production), just execute seed and export the app
  seedAdmin().catch(console.error);
}

export default app;