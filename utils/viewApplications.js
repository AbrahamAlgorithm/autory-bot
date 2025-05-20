const supabase = require('../lib/supabaseClient');

async function viewApplications(userId = null) {
  try {
    let query = supabase
      .from('job_applications')
      .select(`
        *,
        applications:user_id (
          first_name,
          last_name,
          email
        )
      `)
      .order('applied_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) throw error;

    console.table(data.map(app => ({
      Date: new Date(app.applied_at).toLocaleDateString(),
      User: `${app.applications.first_name} ${app.applications.last_name}`,
      Job: app.job_title,
      Company: app.company_name,
      URL: app.job_url
    })));

  } catch (error) {
    console.error('Error fetching applications:', error);
  }
}

module.exports = viewApplications;