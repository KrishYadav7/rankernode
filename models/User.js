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
  /* ⭐ 2026-10-11 — practice: mastered mistakes, daily challenge, streak */
  learning: { type: mongoose.Schema.Types.Mixed, default: {} },
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
    /* ⭐ an extension bought while premium is live — applied once its payment is confirmed */
    pendingPlan:      { type: Object,  default: null },
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
     ⭐ PROFESSOR ACCOUNT (2026-10-07)
     Only used when role === 'professor'.
       status: pending  → registered, waiting for the admin
               approved → may sign in and request courses
               rejected → application turned down (reviewNote = reason)
               revoked  → access withdrawn later by the admin
       courses:  course ids the admin has approved for this professor
       requests: course-access requests (name + code typed by the professor)
     ============================================================ */
  professor: {
    status:          { type: String, default: null },
    designation:     { type: String, default: '' },
    department:      { type: String, default: '' },
    institution:     { type: String, default: '' },
    qualification:   { type: String, default: '' },
    specialization:  { type: String, default: '' },
    experienceYears: { type: Number, default: 0 },
    employeeId:      { type: String, default: '' },
    profileUrl:      { type: String, default: '' },
    bio:             { type: String, default: '' },
    appliedAt:       { type: Date,   default: null },
    reviewedAt:      { type: Date,   default: null },
    reviewedBy:      { type: String, default: '' },
    reviewNote:      { type: String, default: '' },
    courses:         { type: [String], default: [] },
    requests: [{
      courseName:  { type: String, default: '' },
      courseCode:  { type: String, default: '' },
      message:     { type: String, default: '' },
      status:      { type: String, default: 'pending' },   // pending | approved | rejected
      courseId:    { type: String, default: null },        // the course the admin granted
      requestedAt: { type: Date,   default: Date.now },
      reviewedAt:  { type: Date,   default: null },
      reviewedBy:  { type: String, default: '' },
      reviewNote:  { type: String, default: '' }
    }]
  },

  /* ============================================================
     ACTIVE SESSION
     ============================================================ */
  activeSession: {
    sessionId:  { type: String, default: null },
    deviceInfo: { type: String, default: '' },
    loginAt:    { type: Date,   default: null },
    lastSeenAt: { type: Date,   default: null }
  },

  /* ============================================================
     ⭐ ADMIN MULTI-DEVICE SESSIONS (2026-10-08)
     Admin accounts may stay signed in on up to ADMIN_MAX_SESSIONS
     (default 3) devices at once. Signing in on one more device signs
     out the least-recently-used one. Students and professors keep
     the single-device `activeSession` above — this list stays empty.
     ============================================================ */
  sessions: [{
    _id:        false,
    sessionId:  { type: String, required: true },
    deviceInfo: { type: String, default: '' },
    ip:         { type: String, default: '' },
    loginAt:    { type: Date,   default: Date.now },
    lastSeenAt: { type: Date,   default: Date.now }
  }]
}, { timestamps: true });

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ 'subscription.status': 1 });
userSchema.index({ role: 1, email: 1 });
userSchema.index({ 'suspended.active': 1 });
userSchema.index({ role: 1, 'professor.status': 1 });

module.exports = mongoose.model('User', userSchema);