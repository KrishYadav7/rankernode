const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role:     { type: String, default: 'student' },
  fullName: String,
  email:    String,
  phone:    { type: String, default: '' },

  purchases: { type: [String], default: [] },
  /* RankerNode — the category the student chose (Category.key) */
  examCategory: { type: String, default: '' },

  bookmarks: { type: [String], default: [] },
  progress:  { type: Map, of: [String], default: {} },
  lastActivity: {
    courseId:   { type: String, default: null },
    materialId: { type: String, default: null },
    timestamp:  { type: Date,   default: null }
  },

  streakCount:    { type: Number, default: 0 },
  longestStreak:  { type: Number, default: 0 },
  lastActiveDate: { type: String, default: null },

  /* ============================================================
     XP & LEVEL SYSTEM
     ============================================================ */
  xp:    { type: Number, default: 0, index: true },
  level: { type: Number, default: 1 },
  achievements: [{
    id:         { type: String, required: true },
    unlockedAt: { type: Date, default: Date.now }
  }],

  notifications: [{
    id:        { type: String },
    type:      { type: String, default: 'info' },
    title:     { type: String },
    body:      { type: String },
    courseId:  { type: String, default: null },
    link:      { type: String, default: null },
    read:      { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],

  quizResults: { type: Map, of: Object, default: {} },
  // ↑ Each value now may contain:
  //   {
  //     score, total, percent, marksEarned, marksPossible, attempts, lastAttemptAt,
  //     subjectiveAnswers: { "<questionIndex>": [{ url, fileName }, ...] },
  //     subjectiveEvaluations: {
  //       "<questionIndex>": { awardedMarks, feedback, evaluatedAt, evaluatedBy }
  //     },
  //     pendingEvaluation: Boolean,
  //     manuallyEvaluated: Boolean
  //   }

  /* ============================================================
     SUBSCRIPTION / AUTO-PAY  (multi-tier aware)
     ============================================================ */
  subscription: {
    active:           { type: Boolean, default: false },
    status:           { type: String,  default: 'none' },
    // none | pending | active | expired | cancelled | halted

    planId:           { type: String,  default: null },   // e.g. 'plan_6m'
    planTitle:        { type: String,  default: '' },     // snapshot for display
    planDurationDays: { type: Number,  default: 0 },

    razorpayPlanId:   { type: String,  default: null },
    subscriptionId:   { type: String,  default: null },   // Razorpay sub id (if subscription mode)
    lastOrderId:      { type: String,  default: null },   // Razorpay order id (if one-time mode)

    startedAt:        { type: Date,    default: null },
    expiresAt:        { type: Date,    default: null },
    amount:           { type: Number,  default: 0 },
    amountPaid:       { type: Number,  default: 0 },
    couponApplied:    { type: String,  default: null },

    autoRenew:        { type: Boolean, default: false },
    paymentMode:      { type: String,  default: 'subscription' }, // 'subscription' | 'one-time'
    lastPaymentId:    { type: String,  default: null },

    history: [{
      paymentId: String,
      amount:    Number,
      status:    String,   // charged | granted | revoked | failed | refunded | referred-reward | coupon
      note:      String,
      date:      { type: Date, default: Date.now }
    }]
  },

  /* ============================================================
     REFERRAL PROGRAM
     ------------------------------------------------------------
     IMPORTANT: `unique: true` ALONE creates the index.
     DO NOT add `index: true` — Mongoose 8.9+/9.x throws
     "Duplicate schema index" and crashes the process on boot.
     ============================================================ */
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true,
    trim: true
  },
  referredBy: { type: String, default: null },   // referral code of the person who invited this user

  referralStats: {
    totalReferred:   { type: Number, default: 0 },
    totalSubscribed: { type: Number, default: 0 },
    rewardsEarned:   { type: Number, default: 0 },
    rewardedFor:     { type: Number, default: 0 },   // last totalReferred count that was rewarded
    lastRewardAt:    { type: Date,   default: null }
  },

  /* ============================================================
     ANALYTICS
     ============================================================ */
  activityLog: [{
    date:       { type: String },
    timestamp:  { type: Date, default: Date.now },
    type:       { type: String, default: 'view' },
    courseId:   { type: String, default: null },
    materialId: { type: String, default: null },
    score:      { type: Number, default: null },
    total:      { type: Number, default: null }
  }],

  /* ============================================================
     ⭐ VIDEO WATCH PROGRESS (2026-10-04)
     materialId → { courseId, pos, dur, pct, completed, updatedAt }
     pct only ever increases (stored with $max) so rewatching the
     intro never lowers a finished lecture's progress.
     ============================================================ */
  videoProgress: {
    type: Map,
    of: new mongoose.Schema({
      courseId:  { type: String, default: null },
      pos:       { type: Number, default: 0 },     // last position (s)
      dur:       { type: Number, default: 0 },     // duration (s)
      pct:       { type: Number, default: 0 },     // furthest-watched %, 0–100
      completed: { type: Boolean, default: false },
      updatedAt: { type: Date, default: Date.now }
    }, { _id: false }),
    default: {}
  },

  /* ============================================================
     ⭐ CONTENT-SHIELD AUDIT (2026-10-04) — screenshot / print /
     screen-record attempts reported by content-shield.js
     ============================================================ */
  security: {
    captureAttempts: { type: Number, default: 0 },
    lastCaptureAt:   { type: Date,   default: null },
    log: [{
      _id:  false,
      at:   { type: Date, default: Date.now },
      kind: { type: String, default: '' },
      path: { type: String, default: '' }
    }],
    /* Bulk-access guard: "opened N materials in 15 min" alerts for admins */
    lastFlagAt: { type: Date, default: null },
    flags: [{
      _id:    false,
      at:     { type: Date, default: Date.now },
      reason: { type: String, default: '' }
    }]
  },

  /* ============================================================
     ⭐ ACCOUNT SUSPENSION (admin tool, 2026-10-04)
     ============================================================ */
  suspended: {
    active: { type: Boolean, default: false },
    reason: { type: String, default: '' },
    at:     { type: Date, default: null },
    by:     { type: String, default: '' }
  },

  /* ============================================================
     ACTIVE SESSION
     ============================================================ */
  activeSession: {
    sessionId:  { type: String, default: null },
    deviceInfo: { type: String, default: '' },
    loginAt:    { type: Date,   default: null },
    lastSeenAt: { type: Date,   default: null }
  }
}, { timestamps: true });

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ 'subscription.status': 1 });
userSchema.index({ role: 1, email: 1 });
userSchema.index({ 'suspended.active': 1 });

module.exports = mongoose.model('User', userSchema);