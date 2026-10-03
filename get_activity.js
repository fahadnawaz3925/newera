const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function generateReport() {
  try {
    let markdown = '# Account 1 & 2 Database Report\n\n';

    // Account 1
    markdown += '## Account 1 (@pelleelegantee)\n\n';
    const { data: acc1Data } = await supabase
      .from('reels_queue')
      .select('id, url, status, error_log, created_at')
      .or('account_id.eq.account1,account_id.is.null')
      .order('created_at', { ascending: false });

    if (acc1Data) {
      markdown += `### Recent Activity (Latest 15)\n\n`;
      markdown += `| ID | Status | Updated At | Info / Error |\n`;
      markdown += `|---|---|---|---|\n`;
      acc1Data.slice(0, 15).forEach(item => {
        const errLog = item.error_log ? String(item.error_log).replace(/\\n/g, ' ').substring(0, 50) + '...' : '-';
        markdown += `| \`${item.id.substring(0,8)}\` | **${item.status}** | ${new Date(item.created_at).toLocaleString()} | ${errLog} |\n`;
      });

      markdown += `\n### All Video Links in Queue (${acc1Data.length} total)\n\n`;
      acc1Data.forEach(item => {
        markdown += `- [${item.status}] ${item.url}\n`;
      });
    }

    markdown += '\n---\n\n';

    // Account 2
    markdown += '## Account 2 (@buffedboujee)\n\n';
    const { data: acc2Data } = await supabase
      .from('reels_queue')
      .select('id, url, status, error_log, created_at')
      .eq('account_id', 'account2')
      .order('created_at', { ascending: false });

    if (acc2Data) {
      markdown += `### Recent Activity (Latest 15)\n\n`;
      markdown += `| ID | Status | Updated At | Info / Error |\n`;
      markdown += `|---|---|---|---|\n`;
      acc2Data.slice(0, 15).forEach(item => {
        const errLog = item.error_log ? String(item.error_log).replace(/\\n/g, ' ').substring(0, 50) + '...' : '-';
        markdown += `| \`${item.id.substring(0,8)}\` | **${item.status}** | ${new Date(item.created_at).toLocaleString()} | ${errLog} |\n`;
      });

      markdown += `\n### All Video Links in Queue (${acc2Data.length} total)\n\n`;
      acc2Data.forEach(item => {
        markdown += `- [${item.status}] ${item.url}\n`;
      });
    }

    fs.writeFileSync('C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\85c005e7-a052-42f8-b95c-1889ea2bedcd\\accounts_activity.md', markdown);
    console.log('Report generated successfully!');
  } catch (err) {
    console.error('Error generating report:', err);
  }
}

generateReport();
