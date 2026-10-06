require('dotenv').config();
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const Course = require('../models/Course');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

(async () => {
  try {
    console.log('🔄 MongoDB connect ho raha hai...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected');

    const courses = await Course.find({});
    console.log(`📚 Total courses: ${courses.length}`);

    let migrated = 0, skipped = 0, failed = 0;

    for (const course of courses) {
      for (const mat of course.materials) {
        if (!mat.fileData || !mat.fileData.startsWith('data:')) {
          skipped++;
          continue;
        }
        try {
          console.log(`📤 Uploading: ${mat.title} (${course.name})`);
          const result = await cloudinary.uploader.upload(mat.fileData, {
            resource_type: 'auto',
            folder: 'rankernode/uploads',
            public_id: `mat_${mat._id}`
          });
          mat.url = result.secure_url;
          mat.fileData = '';
          migrated++;
          console.log(`   ✅ ${result.secure_url}`);
        } catch (e) {
          failed++;
          console.error(`   ❌ ${mat.title}:`, e.message);
        }
      }
      await course.save();
    }

    console.log('\n═══════════════════════════');
    console.log(`✅ Migrated: ${migrated}`);
    console.log(`⏭️  Skipped:  ${skipped}`);
    console.log(`❌ Failed:   ${failed}`);
    console.log('═══════════════════════════');
    console.log('🎉 Migration complete!');
    process.exit(0);
  } catch (e) {
    console.error('💥 Fatal:', e);
    process.exit(1);
  }
})();