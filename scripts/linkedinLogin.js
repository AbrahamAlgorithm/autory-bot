const puppeteer = require('puppeteer');
const supabase = require('../lib/supabaseClient');
const { timeout } = require('puppeteer');

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

    // filter the search to easyapply
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

async function applyJobs(page) {
  try {
    console.log('Starting job applications...');

    // // Wait for job list to load
    // await page.waitForSelector('ul.YdifWvHhBvBLKVsIfxxTNXHfIrEvRavSUbweYDo', {
    //   visible: true,
    //   timeout: 30000
    // });

    // Get all job items
    const jobItems = await page.$$('li.occludable-update');
    console.log(`Found ${jobItems.length} jobs`);

    for (let i = 0; i < jobItems.length; i++) {
      try {
        // Click the job item
        console.log(`Clicking job #${i + 1}`);
        await jobItems[i].evaluate(node => {
          const clickable = node.querySelector('a, button, [role="button"]') || node;
          clickable.click();
        });

        // Wait for job details to load
        await delay(2000);

        // Look for Easy Apply button
        const applyButton = await page.waitForSelector('button#jobs-apply-button-id', {
          visible: true,
          timeout: 10000
        });

        if (applyButton) {
          console.log('Easy Apply button found, clicking it');
          await applyButton.click();

          // Wait for application modal
          await delay(2000);

          // Check for submit button
          const submitButton = await page.$('button[aria-label="Submit application"]');
          if (submitButton) {
            await submitButton.click();
            console.log('Application submitted');
            await delay(2000);
          }

          // Close any modal if present
          const closeButton = await page.$('button[aria-label="Dismiss"]');
          if (closeButton) {
            await closeButton.click();
            await delay(1000);
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

async function loginToLinkedin() {
  try {
    const { data: application, error } = await supabase
      .from('applications')
      .select('linkedin_email, linkedin_password, job_title, job_location')
      .not('linkedin_email', 'is', null)
      .not('linkedin_password', 'is', null)
      .limit(1)
      .single();

    if (error || !application) {
      throw new Error('No application with LinkedIn credentials found');
    }

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

    console.log('Waiting for 1 minute on search results page...');
    await delay(2000);

    console.log('Starting job applications...');
    await applyJobs(page);

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
// ...existing code...

// Runs the script
loginToLinkedin()
  .then(() => console.log('Login process completed successfully'))
  .catch(error => console.error('Script failed:', error));