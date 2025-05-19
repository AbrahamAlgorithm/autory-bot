const puppeteer = require('puppeteer');
const supabase = require('../lib/supabaseClient');
const { timeout } = require('puppeteer');
const XLSX = require('xlsx');
const path = require('path');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function typeWithSlowMotion(page, selector, text) {
  for (let char of text) {
    await page.type(selector, char, {
      delay: Math.floor(Math.random() * 200) + 100
    });
  }
}

async function searchJobs(page, jobTitle, jobLocation) {
  try {
    console.log('Waiting for search fields...');
    await page.waitForSelector('input[aria-label="Search by title, skill, or company"]', {
      visible: true,
      timeout: 30000
    });
    await page.waitForSelector('input[aria-label="City, state, or zip code"]', {
      visible: true,
      timeout: 30000
    });

    await page.evaluate(() => {
      document.querySelector('input[aria-label="Search by title, skill, or company"]').value = '';
      document.querySelector('input[aria-label="City, state, or zip code"]').value = '';
    });

    console.log('Entering job title:', jobTitle);
    await typeWithSlowMotion(page, 'input[aria-label="Search by title, skill, or company"]', jobTitle);
    await delay(1000);

    console.log('Entering location:', jobLocation);
    await typeWithSlowMotion(page, 'input[aria-label="City, state, or zip code"]', jobLocation);
    await delay(500);

    console.log('Submitting search...');
    await page.keyboard.press('Enter');

    console.log('Waiting for search results...');
    await delay(3000);

    await page.click('button[aria-label="Easy Apply filter."]');
    await delay(2000);
    console.log('Clicked the easy apply button')

    await delay(6000);

    console.log('Search completed successfully');
  } catch (error) {
    console.error('Job search failed:', error);
    throw error;
  }
}

async function applyJobs(page, application) {
  try {
    // Get all job 
    const jobItems = await page.$$('li.occludable-update');
    console.log(`Found ${jobItems.length} jobs`);

    for (let i = 0; i < jobItems.length; i++) {
      try {
        console.log(`Clicking job #${i + 1}`);
        await jobItems[i].evaluate(node => {
          const clickable = node.querySelector('a, button, [role="button"]') || node;
          clickable.click();
        });
        await delay(2000);

        const applyButton = await page.waitForSelector('button#jobs-apply-button-id', {
          visible: true,
          timeout: 10000
        });

        if (applyButton) {
          console.log('Easy Apply button found, clicking it');
          await applyButton.click();

          await delay(2000);

        const success = await fillForm(page, application);

        if (success) {
            console.log("✅ Application submitted successfully.");
        } else {
            console.log("⚠️ Application failed/skipped.");
        }
        }

      } catch (error) {
        console.warn(`Error processing job #${i + 1}:`, error.message);
        continue;
      }
    }

    console.log('All jobs processed');

  } catch (error) {
    console.error('Error in applyJobs:', error);
    throw error;
  }
}

function decideInputValue(label, application) {
  label = label.toLowerCase();

  if (label.includes('first name')) return application.first_name;
  if (label.includes('last name')) return application.last_name;
  if (label.includes('phone')) return application.phone_number;
  if (label.includes('location')) return application.job_location;
  if (label.includes('years')) return application.relevant_experience;
  if (label.includes('experience')) return application.total_experience;
  if (label.includes('current location')) return application.current_location;
  if (label.includes('preferred location')) return application.preferred_location;
  if (label.includes('Street address')) return application.current_location;
  if (label.includes('country')) return application.current_location;
  if (label.includes('state')) return application.current_location;
  if (label.includes('zip') || label.includes('postal')) return application.postal_code;
  if (label.includes('country code')) return application.phone_country_code;
  if (label.includes('city')) return application.city;
  if (label.includes('ctc')) return application.current_ctc;
  if (label.includes('expected')) return application.expected_ctc;
  if (label.includes('current') && label.includes('compensation')) return application.current_ctc;
  if (label.includes('current salary (gross)')) return application.current_ctc;
  if (label.includes('expected salary (gross)')) return application.expected_ctc;
  if (label.includes('current salary')) return application.current_ctc;
  if (label.includes('salary')) return application.expected_ctc;
  if (label.includes('total experience')) return application.total_experience;
  if (label.includes('relevant experience')) return application.relevant_experience;
  if (label.includes('notice period')) return application.notice_period;
  if (label.includes('notice')) return application.notice_period;
  if (label.includes('linkedin')) return application.linkedin_url;
  if (label.includes('linkedin profile')) return application.linkedin_url;
  if (label.includes('cover letter')) return application.cover_letter;
  if (label.includes('onsite')) return 'Yes';
  if (label.includes('remote')) return 'Yes';
  if (label.includes('hybrid')) return 'Yes';
  if (label.includes('email')) return null;

  // Fallbacks
  if (label.includes('why') || label.includes('describe') || label.includes('reason')) return '1';
  if (label.includes('what') || label.includes('salary expectation') || label.includes('current compensation')) return application.expected_ctc;
  if (label.includes('how many') || label.includes('number')) return '1';
  if (label.includes('authorized') || label.includes('eligible') || label.includes('sponsorship')) return 'Yes';
  if (label.includes('currently working') || label.includes('employed')) return 'Yes';
  if (label.includes('willing') && label.includes('relocate')) return 'Yes';

  return 'N/A';
}


async function fillForm(page, application) {
  try {
    console.log('📝 Starting to fill form...');
    let step = 1;

    while (true) {
      console.log(`🔁 Step ${step}...`);

      // Handle radio buttons first - Always select "Yes"
      const yesRadios = await page.$$('input[data-test-text-selectable-option__input="Yes"]');
      for (const radio of yesRadios) {
        try {
          await radio.click();
          console.log('✅ Selected "Yes" for radio option');
          await delay(300);
        } catch (error) {
          console.warn('⚠️ Failed to click radio button:', error.message);
        }
      }

      // Handle dropdowns - Always select "Yes"
      const dropdowns = await page.$$('select[data-test-text-entity-list-form-select]');
      for (const dropdown of dropdowns) {
        try {
          await page.evaluate(select => {
            select.value = 'Yes';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }, dropdown);
          console.log('✅ Selected "Yes" for dropdown');
          await delay(300);
        } catch (error) {
          console.warn('⚠️ Failed to set dropdown value:', error.message);
        }
      }

      // Handle required inputs
      const inputs = await page.$$('form input[required]');

      for (const input of inputs) {
        const id = await input.evaluate(el => el.id);
        const label = await page.evaluate((id) => {
          const labelEl = document.querySelector(`label[for="${id}"]`);
          return labelEl ? labelEl.innerText : '';
        }, id);

        if (!label) continue;

        const fillValue = await decideInputValue(label, application);  // Note the await here

        if (fillValue) {
          await input.evaluate(el => el.value = '');
          await input.focus();
          await delay(100);
          await input.type(fillValue.toString(), { delay: 20 });
          console.log(`✅ Filled "${label}" with AI-generated response`);
        }
      }

      // Wait for LinkedIn to process any input changes
      await delay(1000);

      // Check for buttons in order of form flow
      const nextBtn = await page.$('button[aria-label="Continue to next step"]');
      const reviewBtn = await page.$('button[aria-label="Review your application"]');
      const submitBtn = await page.$('button[aria-label="Submit application"]');

      if (nextBtn) {
        await nextBtn.click();
        console.log("➡️ Clicked 'Next'");
        await delay(1500);
        step++;
        continue;
      } else if (reviewBtn) {
        await reviewBtn.click();
        console.log("🔍 Clicked 'Review'");
        await delay(1500);
        step++;
        continue;
      } else if (submitBtn) {
        await submitBtn.click();
        console.log("✅ Clicked 'Submit Application'");
        await delay(1500);
        break;
      } else {
        console.log("⛔ No navigation buttons found. Possibly stuck.");
        break;
      }
    }

    console.log("🎉 Form filled and submitted.");
    await delay(2000);
      const dismissButton = await page.$('button[aria-label="Dismiss"][data-test-modal-close-btn]');
      if (dismissButton) {
        await dismissButton.click();
        console.log("🔒 Closed success popup");
        await delay(1000);
      }
    return true;


  } catch (err) {
    console.error("❌ Error filling form:", err.message);
    return false;
  }
}

async function getApplicationData() {
  try {
    const workbook = XLSX.readFile(path.join(__dirname, '..', 'applications.xlsx'));
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const applications = XLSX.utils.sheet_to_json(worksheet);

    const application = applications.find(app => 
      app.linkedin_email && 
      app.linkedin_password
    );

    if (!application) {
      throw new Error('No application with LinkedIn credentials found');
    }

    return application;
  } catch (error) {
    console.error('Error reading Excel file:', error);
    throw error;
  }
}

async function loginToLinkedin() {
  try {
    const application = await getApplicationData();

    const browser = await puppeteer.launch({
      headless: false,
      slowMo: 50,
      defaultViewport: null,
      args: ['--start-maximized']
    });

    const page = await browser.newPage();

    console.log('Navigating to LinkedIn...');
    await page.goto('https://www.linkedin.com/login', {
      waitUntil: 'networkidle0'
    });

    console.log('Entering email...');
    await typeWithSlowMotion(page, '#username', application.linkedin_email);
    await delay(1000);

    console.log('Entering password...');
    await typeWithSlowMotion(page, '#password', application.linkedin_password);
    await delay(500);

    console.log('Clicking sign in...');
    await page.click('button[type="submit"]');
    console.log('Waiting for successful login...');
    await page.waitForSelector('.global-nav__content', {
      visible: true,
      timeout: 60000
    });
    
    console.log('Successfully logged in!');
    await delay(2000);
    console.log('Navigating to Jobs page...');
    await page.waitForSelector('a[href="https://www.linkedin.com/jobs/?"]', {
      visible: true,
      timeout: 30000
    });
    
    await page.click('a[href="https://www.linkedin.com/jobs/?"]');

    console.log('Waiting for Jobs page to load...');
    await delay(10000);
    
    console.log('Jobs page loaded successfully!');

    await searchJobs(page, application.job_title, application.job_location);

    console.log('Starting job applications...');
    await applyJobs(page, application);  // Pass application data

    console.log('Closing browser...');
    await browser.close();

  } catch (error) {
    console.error('Operation failed:', error);
    if (error.name === 'TimeoutError') {
      console.log('Timeout while waiting for element. Please check if the page loaded correctly.');
    }
    throw error;
  }
}

// Runs the script
loginToLinkedin()
  .then(() => console.log('Login process completed successfully'))
  .catch(error => console.error('Script failed:', error));