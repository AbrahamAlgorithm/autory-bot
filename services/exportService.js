const XLSX = require('xlsx');
const supabase = require('../lib/supabaseClient');
const fs = require('fs');
const path = require('path');

class ExportService {
  async exportApplicationsToExcel() {
    const fileName = 'applications.xlsx';
    
    try {
      // Delete existing file if it exists
      if (fs.existsSync(fileName)) {
        fs.unlinkSync(fileName);
        console.log('🗑️ Deleted existing Excel file');
      }

      // Fetch all applications
      const { data: applications, error } = await supabase
        .from('applications')
        .select('*');

      if (error) throw error;

      if (!applications || applications.length === 0) {
        throw new Error('No applications found');
      }

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(applications, {
        header: [
          'id', 'user_id', 'created_at', 'updated_at', 'job_title',
          'job_location', 'first_name', 'last_name', 'phone_country_code',
          'phone_number', 'email', 'linkedin_url', 'linkedin_email',
          'linkedin_password', 'current_ctc', 'expected_ctc',
          'total_experience', 'relevant_experience', 'current_location',
          'preferred_location', 'city', 'notice_period',
          'notice_period_details', 'cover_letter', 'resume_url',
          'gender', 'race_ethnicity', 'disability', 'veteran_status',
          'additional_info', 'status'
        ]
      });

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Applications');
      
      // Write to file
      XLSX.writeFile(workbook, fileName);
      console.log('📊 Created new Excel file');

      return fileName;

    } catch (error) {
      console.error('❌ Export failed:', error);
      throw error;
    }
  }
}

module.exports = ExportService;