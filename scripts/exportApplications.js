const ExportService = require('../services/exportService');

async function runExport() {
  try {
    const exporter = new ExportService();
    const fileName = await exporter.exportApplicationsToExcel();
    console.log(`Export successful! File created: ${fileName}`);
  } catch (error) {
    console.error('Export failed:', error);
  }
}

runExport();