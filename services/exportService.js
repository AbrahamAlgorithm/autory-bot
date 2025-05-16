const XLSX = require('xlsx');
const supabase = require('../lib/supabaseClient');

class ExportService {
  async exportApplicationsToExcel() {
    try {
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

      // Generate filename with timestamp
      const fileName = `applications_${new Date().toISOString().split('T')[0]}.xlsx`;
      
      // Write to file
      XLSX.writeFile(workbook, fileName);

      return fileName;

    } catch (error) {
      console.error('Export failed:', error);
      throw error;
    }
  }
}

module.exports = ExportService;