#!/usr/bin/env node

const ExportService = require('./services/exportService');
const { processAllUsers } = require('./scripts/linkedinBot');
const { program } = require('commander');

const HOUR_IN_MS = 60 * 60 * 1000; // 1 hour in milliseconds

program
  .version('1.0.0')
  .description('LinkedIn Job Application Bot')
  .option('-e, --export-only', 'Only export applications to Excel')
  .option('-b, --bot-only', 'Only run LinkedIn bot')
  .parse(process.argv);

const options = program.opts();

async function runBot() {
  while (true) {
    try {
      const startTime = new Date();
      console.log(`\n🔄 Starting new bot cycle at ${startTime.toLocaleString()}`);

      if (!options.botOnly) {
        console.log('📊 Starting applications export...');
        const exportService = new ExportService();
        await exportService.exportApplicationsToExcel();
        console.log('✅ Applications exported successfully');
      }

      if (!options.exportOnly) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('🤖 Starting LinkedIn automation...');
        await processAllUsers();
        console.log('✅ LinkedIn automation completed');
      }

      const endTime = new Date();
      console.log(`\n⏰ Cycle completed at ${endTime.toLocaleString()}`);
      console.log('💤 Waiting 1 hour before next cycle...');
      
      await new Promise(resolve => setTimeout(resolve, HOUR_IN_MS));
    } catch (error) {
      console.error('❌ Error in bot cycle:', error);
      console.log('🔄 Restarting in 1 hour...');
      await new Promise(resolve => setTimeout(resolve, HOUR_IN_MS));
    }
  }
}

async function main() {
  try {
    // Handle SIGINT (Ctrl+C) gracefully
    process.on('SIGINT', () => {
      console.log('\n👋 Bot stopped by user');
      process.exit(0);
    });

    await runBot();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});