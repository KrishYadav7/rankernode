const mongoose = require('mongoose');

/* ---------- Matrix Match row (one row of List-I with its correct List-II answer) ---------- */
const matrixRowSchema = new mongoose.Schema({
  text:         { type: String, default: '' },
  correctIndex: { type: Number, default: 0 }
}, { _id: false });

/* ---------- Quiz Question (supports 6 types) ---------- */
const quizQuestionSchema = new mongoose.Schema({
  type: { type: String, default: 'single' },
  // single | multiple | integer | numerical | matrix | subjective

  question:    { type: String, default: '' },
  explanation: { type: String, default: '' },

  options:        { type: [String], default: [] },
  correctIndexes: { type: [Number], default: [] },

  /* Integer — exact match with optional ±tolerance */
  integerAnswer:    { type: Number, default: null },
  integerTolerance: { type: Number, default: 0 },

  /* Numerical Range — answer accepted if rangeMin ≤ answer ≤ rangeMax */
  rangeMin: { type: Number, default: null },
  rangeMax: { type: Number, default: null },

  /* Subjective — file uploads, admin manually evaluates */
  subjectiveMaxMarks: { type: Number, default: 10 },
  subjectiveInstructions: { type: String, default: '' },

  matrixLeftItems:  { type: [String], default: [] },
  matrixRightItems: { type: [String], default: [] },
  matrixRows:       { type: [matrixRowSchema], default: [] },

  marks:         { type: Number, default: 4 },
  negativeMarks: { type: Number, default: -1 }
}, { _id: true });

/* ---------- Material ---------- */
/* ---------- Material ---------- */
const materialSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type:  { type: String, required: true },
  description: String,

  url:      String,
  cloudUrl: String,
  fileData: String,
  fileName: String,

  cloudinaryPublicId: { type: String, default: '' },

  /* Chapter this material belongs to (Course.chapters[]._id as a string; '' = not in a chapter) */
  chapterId: { type: String, default: '' },

  isPremium: { type: Boolean, default: false },
  price: { type: Number, default: 0 },

  // ⭐ NEW — Free Preview Percentage (0 = disabled, 1–100 = % of pages free)
  previewPercent: { type: Number, default: 0, min: 0, max: 100 },

  estimatedTime: { type: String, default: '' },
  tags: { type: String, default: '' },

   examConfig: {
    subject:    { type: String, default: '' },
    paperCode:  { type: String, default: '' },
    totalTime:  { type: String, default: '' },
    totalMarks: { type: Number, default: 0 },

    /* Per-quiz navigation policy (unchanged) */
    allowBackNavigation: { type: Boolean, default: false },
    showQuestionPalette: { type: Boolean, default: true },

    /* ⭐ NEW — Attempt limits.
       0  = unlimited (default → existing quizzes keep working)
       >0 = the student may submit this many attempts, then the
            Start / Retake button is disabled. Attempts are counted
            on the Server via User.quizResults[materialId].attempts. */
    maxAttempts: { type: Number, default: 0, min: 0 },

    /* ⭐ NEW — Scheduled result publication.
       'immediate' → score shown the moment the quiz is submitted
                     (identical to the pre-update behaviour)
       'scheduled' → score is stored server-side but hidden from the
                     student until resultPublishAt (or the delay)
                     elapses; a background sweeper publishes + sends
                     notifications at exactly that time
       'manual'    → score stays hidden until the admin clicks
                     "Publish Now" in the quiz editor */
    resultPublishMode: {
      type: String,
      enum: ['immediate', 'scheduled', 'manual'],
      default: 'immediate'
    },

    /* Absolute publish time. Wins over resultPublishDelayHours
       when both are set. Stored as a UTC Date so it is timezone
       independent on the server side. */
    resultPublishAt: { type: Date, default: null },

    /* Convenience alternative to an absolute date: "publish N hours
       after the student submits". Evaluated per-student so a student
       who took the exam earlier doesn't have to wait for a late
       joiner. Only used when resultPublishMode === 'scheduled' AND
       resultPublishAt is null. */
    resultPublishDelayHours: { type: Number, default: 0, min: 0 },

    /* Flag flipped by the publisher (cron or admin) so a course is
       never published twice. */
    resultsPublished:   { type: Boolean, default: false },
    resultsPublishedAt: { type: Date,    default: null }
  },

  quiz: [quizQuestionSchema]
});

/* ---------- Q&A ---------- */
const replySchema = new mongoose.Schema({
  authorName:     String,
  authorUsername: String,
  authorRole:     { type: String, default: 'student' },
  text:           { type: String, required: true },
  date:           { type: Date, default: Date.now },
  isAccepted:     { type: Boolean, default: false }
});

const doubtSchema = new mongoose.Schema({
  studentName: String,
  studentUsername: String,
  studentEmail: String,
  question: String,
  answer: String,
  date: { type: Date, default: Date.now },
  replies: [replySchema]
});

/* ---------- Announcements ---------- */
const announcementSchema = new mongoose.Schema({
  id:         String,
  title:      String,
  body:       String,
  authorName: String,
  date:       { type: Date, default: Date.now }
});

/* ---------- Playlists ---------- */
const playlistSchema = new mongoose.Schema({
  id:          { type: String, required: true },
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  materialIds: { type: [String], default: [] },
  createdAt:   { type: Date, default: Date.now }
});
/* ---------- Chapters (RankerNode) ----------
   A subject course is organised strictly chapter by chapter.
   Materials point at their chapter through material.chapterId. */
const chapterSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  order:       { type: Number, default: 0 }
}, { timestamps: true });

/* ---------- Certificate (per-course eligibility + toggle) ---------- */
const certificateSchema = new mongoose.Schema({
  enabled:               { type: Boolean, default: false },
  minCompletionPercent:  { type: Number,  default: 100, min: 0, max: 100 },
  minAverageQuizPercent: { type: Number,  default: 0,   min: 0, max: 100 },
  minQuizzesPassed:      { type: Number,  default: 0,   min: 0 },
  quizPassThreshold:     { type: Number,  default: 60,  min: 0, max: 100 }
}, { _id: false });
/* ---------- Course ---------- */
const courseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  semester: String,
  instructor: String,
  description: String,

  category:   { type: String, default: 'General' },

  /* RankerNode — which academic categories (Category.key) this
     course is listed under, and its subject (physics, chemistry, …). */
  tracks:  { type: [String], default: [] },
  subject: { type: String, default: '' },
  chapters: { type: [chapterSchema], default: [] },
  difficulty: { type: String, default: 'Intermediate' },
  duration:   { type: String, default: '' },
  credits:    { type: Number, default: 0 },
  language:   { type: String, default: '' },
  learningOutcomes: { type: [String], default: [] },
  thumbnail:  { type: String, default: '' },
  status:     { type: String, default: 'published' },
  featured:   { type: Boolean, default: false },

  isPremium: { type: Boolean, default: false },
  price:     { type: Number, default: 0 },

  certificate: { type: certificateSchema, default: () => ({}) },

  materials: [materialSchema],
  doubts:    [doubtSchema],
  announcements: [announcementSchema],
  playlists: [playlistSchema]
}, { timestamps: true });

courseSchema.index({ status: 1, createdAt: -1 });
courseSchema.index({ code: 1 });
courseSchema.index({ featured: -1, createdAt: -1 });
courseSchema.index({ tracks: 1, subject: 1 });
courseSchema.index({ createdAt: -1 });
courseSchema.index({ status: 1, featured: -1 });
courseSchema.index({ name: 'text', code: 'text', description: 'text' });
// Fast lookup by filename for the disk-miss → Cloudinary fallback path
courseSchema.index({ 'materials.url': 1 });
courseSchema.index({ 'materials.cloudinaryPublicId': 1 });

module.exports = mongoose.model('Course', courseSchema);