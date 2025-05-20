const puppeteer = require('puppeteer');
const supabase = require('../lib/supabaseClient');
const { timeout } = require('puppeteer');
const MAX_USER_PROCESSING_TIME = 30 * 60 * 1000; 
const XLSX = require('xlsx');
const path = require('path');
const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MAX_DAILY_APPLICATIONS = 50;
const APPLICATION_TIMESTAMP_KEY = 'last_application_date';
const DAILY_COUNT_KEY = 'daily_application_count';
const MAX_FORM_FILL_TIME = 3 * 60 * 1000; // 3 minutes in milliseconds
const MAX_STEPS = 10; // Maximum number of form steps before considering it a loop

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function typeWithSlowMotion(page, selector, text) {
  for (let char of text) {
    await page.type(selector, char, {
      delay: Math.floor(Math.random() * 200) + 100
    });
  }
}

async function processAllUsers() {
  try {
    const applications = await getApplicationData();
    console.log(`Found ${applications.length} users to process`);

    for (const application of applications) {
      console.log(`\n📝 Processing user: ${application.first_name} ${application.last_name}`);

      // Check daily application limit
      const canApply = await checkDailyLimit(application.user_id);
      if (!canApply) {
        console.log(`⚠️ User ${application.first_name} has reached daily limit of ${MAX_DAILY_APPLICATIONS} applications`);
        continue;
      }

      let browser;
      try {
        const processingPromise = (async () => {
          browser = await puppeteer.launch({
            headless: false,
            slowMo: 50,
            defaultViewport: null,
            args: ['--start-maximized']
          });
          const page = await browser.newPage();
          await loginToLinkedin(application, page);
        })();

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('User processing timeout reached (30 minutes)'));
          }, MAX_USER_PROCESSING_TIME);
        });

        await Promise.race([processingPromise, timeoutPromise]);
        console.log(`✅ Completed processing for ${application.first_name}`);

      } catch (error) {
        if (error.message.includes('timeout reached')) {
          console.log(`⏰ Timeout reached for user ${application.first_name}. Moving to next user...`);
        } else {
          console.error(`❌ Error processing user ${application.first_name}:`, error);
        }
      } finally {
        if (browser) {
          try {
            await browser.close();
            console.log('Browser closed successfully');
          } catch (closeError) {
            console.error('Error closing browser:', closeError);
          }
        }
        await delay(5000); // Wait between users
      }
    }

    console.log('\n🎉 Completed processing all users');
  } catch (error) {
    console.error('Failed to process users:', error);
    throw error;
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

async function isJobTitleRelevant(targetTitle, actualTitle) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{
        role: "system",
        content: "You are a job matching expert. Respond with only 'true' or 'false'."
      }, {
        role: "user",
        content: `Is the job title "${actualTitle}" relevant or similar to "${targetTitle}"? Consider job responsibilities and career level. Only respond with true or false.`
      }],
      temperature: 0.1,
      max_tokens: 5
    });

    const answer = response.choices[0].message.content.toLowerCase().trim();
    return answer === 'true';
  } catch (error) {
    console.error('Error checking job relevancy:', error);
    return true; // Default to true in case of API error
  }
}

async function handlePagination(page, currentPage) {
  try {
    // Try first pagination style (artdeco-pagination)
    try {
      const nextPageBtn = await page.$(`[data-test-pagination-page-btn="${currentPage + 1}"]`);
      if (nextPageBtn) {
        console.log(`Moving to page ${currentPage + 1} (Style 1)`);
        await nextPageBtn.click();
        return true;
      }
    } catch (error) {
      console.log('First pagination style not found, trying second style...');
    }

    // Try second pagination style (jobs-search-pagination)
    try {
      const nextButton = await page.$('button.jobs-search-pagination__button--next');
      if (nextButton) {
        const isDisabled = await page.evaluate(btn => 
          btn.classList.contains('artdeco-button--disabled'), nextButton);

        if (!isDisabled) {
          console.log(`Moving to next page (Style 2)`);
          await nextButton.click();
          return true;
        }
      }
    } catch (error) {
      console.log('Second pagination style not found');
    }

    console.log('No more pages available in either style');
    return false;

  } catch (error) {
    console.warn('Error handling pagination:', error.message);
    return false;
  }
}

async function applyJobs(page, application) {
  try {
    while (true) {
      const jobItems = await page.$$('li.occludable-update');
      console.log(`Found ${jobItems.length} total jobs on current page`);

      // Process jobs on current page
      for (let i = 0; i < jobItems.length; i++) {
        try {
          // Check current application count before proceeding
          const canApply = await checkDailyLimit(application.user_id);
          if (!canApply) {
            console.log(`📊 User ${application.first_name} has reached daily limit of ${MAX_DAILY_APPLICATIONS} applications`);
            return; // Exit the function completely
          }

          // Get job title before clicking
          const jobTitle = await jobItems[i].evaluate(node => {
            const titleEl = node.querySelector('.job-card-list__title--link');
            return titleEl ? titleEl.textContent.trim() : '';
          });

          // Check if job is relevant
          const isRelevant = await isJobTitleRelevant(application.job_title, jobTitle);
          
          if (!isRelevant) {
            console.log(`⏩ Skipping job #${i + 1} - Title "${jobTitle}" not relevant to "${application.job_title}"`);
            continue;
          } else {
            console.log(`✅ Job "${jobTitle}" is relevant to "${application.job_title}", applying...`);
          }

          // Check if job has already been applied to
          const isApplied = await jobItems[i].evaluate(node => {
            const footerText = node.querySelector('.job-card-container__footer-item')?.textContent?.trim();
            return footerText === 'Applied';
          });

          if (isApplied) {
            console.log(`⏩ Skipping job #${i + 1} - already applied`);
            continue;
          }

          // Scroll job into view before clicking
          await page.evaluate(element => {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, jobItems[i]);
          
          await delay(1000);

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

            const formFillTimeout = new Promise((resolve) => {
              setTimeout(() => {
                resolve(false);
              }, MAX_FORM_FILL_TIME);
            });

            const formResult = await Promise.race([
              fillForm(page, application),
              formFillTimeout
            ]);

            if (!formResult) {
              console.log("⚠️ Application abandoned due to timeout or error");
              
              // Try to close any open dialogs
              try {
                const closeButton = await page.$('button[aria-label="Dismiss"]');
                if (closeButton) {
                  await closeButton.click();
                  console.log("🔒 Closed application dialog");
                }
              } catch (closeError) {
                console.warn("Could not close dialog:", closeError.message);
              }

              // if there is a discard button, click it
              const discardButton = await page.$('button[data-control-name="discard_application_confirm_btn"]');
              if (discardButton) {
                await discardButton.click();
                console.log("🔒 Discarded application");
              }
              await delay(2000);
              console.log("⏩ Skipping to next job");
              
              continue;
            }

            console.log("✅ Application submitted successfully.");
          }

        } catch (error) {
          console.warn(`Error processing job #${i + 1}:`, error.message);
          continue;
        }
      }

      // After processing all jobs on current page, handle pagination
      try {
        // Find current page number
        let currentPage;
        
        try {
          // Try first style
          currentPage = await page.$eval(
            '.artdeco-pagination__indicator--number.active.selected button span', 
            el => parseInt(el.textContent)
          );
        } catch {
          // Try second style
          currentPage = await page.$eval(
            '.jobs-search-pagination__indicator-button--active span',
            el => parseInt(el.textContent)
          );
        }

        console.log(`Currently on page ${currentPage}`);

        // Handle pagination using new function
        const hasNextPage = await handlePagination(page, currentPage);
        
        if (hasNextPage) {
          await delay(3000); // Wait for new page to load
          
          // Wait for job list to refresh
          await page.waitForSelector('li.occludable-update', {
            visible: true,
            timeout: 10000
          });
        } else {
          console.log('No more pages to process');
          break;
        }
      } catch (paginationError) {
        console.log('Pagination error:', paginationError.message);
        break;
      }
    }

    console.log('Completed processing all available pages');

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
  if (label.includes('notice period')) return '1';
  if (label.includes('notice')) return application.notice_period;
  if (label.includes('linkedin')) return application.linkedin_url;
  if (label.includes('linkedin profile')) return application.linkedin_url;
  if (label.includes('cover letter')) return application.cover_letter;
  if (label.includes('onsite')) return 'Yes';
  if (label.includes('remote')) return 'Yes';
  if (label.includes('hybrid')) return 'Yes';
  if (label.includes('from scale 1 to 10')) return '10';
  if (label.includes('from 1 to 10')) return '10';
  if (label.includes('from 1-10')) return '10';
  if (label.includes('from 1 to 5')) return '5';
  if (label.includes('from 1-5')) return '5';
  if (label.includes('from 1 to 3')) return '3';
  if (label.includes('from 1-3')) return '3';
  if (label.includes('from 1 to 2')) return '2';
  if (label.includes('from 1-2')) return '2';
  if (label.includes('What is your notice period? (Please mention the exact duration in months)')) return '0';
  if (label.includes('Notice Period')) return '0';
  if (label.includes('grade') || label.includes('cgpa') || label.includes('4.0 scale') || label.includes('marks')) return '4.0';
  if (label.includes('grade') || label.includes('cgpa') || label.includes('5.0 scale') || label.includes('marks')) return '5.0';
  if (label.includes('Are you open to work?')) return 'Yes';
  if (label.includes('Are you open to relocation?')) return 'Yes';
  if (label.includes('Are you open to remote work?')) return 'Yes';
  if (label.includes('email')) return null;

  // Fallbacks
  if (label.includes('why') || label.includes('describe') || label.includes('reason')) return '1';
  if (label.includes('what') || label.includes('salary expectation') || label.includes('current compensation')) return application.expected_ctc;
  if (label.includes('how many') || label.includes('number')) return '1';
  if (label.includes('authorized') || label.includes('eligible') || label.includes('sponsorship')) return 'Yes';
  if (label.includes('currently working') || label.includes('employed')) return 'Yes';
  if (label.includes('willing') && label.includes('relocate')) return 'Yes';
  if (label.includes("from scale 1 to 10")) 

  return 'N/A';
}


async function fillForm(page, application) {
  try {
    console.log('📝 Starting to fill form...');
    let step = 1;
    const startTime = Date.now();

    while (true) {
      // Check for timeout
      if (Date.now() - startTime > MAX_FORM_FILL_TIME) {
        console.log('⚠️ Form fill timeout reached. Moving to next job...');
        return false;
      }

      // Check for too many steps
      if (step > MAX_STEPS) {
        console.log('⚠️ Too many form steps. Possible loop detected. Moving to next job...');
        return false;
      }

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

        // Verify successful submission
        try {
          const successIndicator = await page.waitForSelector('.jobs-s-apply--fadein .artdeco-inline-feedback--success', {
            visible: true,
            timeout: 5000
          });

          const appliedText = await successIndicator.$eval('.artdeco-inline-feedback__message', el => el.textContent.trim());
          
          if (appliedText.includes('Applied')) {
            console.log("✅ Application confirmed successful!");

            // Check limit one final time before recording
            const canApply = await checkDailyLimit(application.user_id);
            if (!canApply) {
              console.log(`⚠️ Daily limit reached during submission. Not recording this application.`);
              return false;
            }

            // Get job details and insert to Supabase
            const jobTitle = await page.$eval('.job-details-jobs-unified-top-card__job-title a', 
              el => el.textContent.trim());
            const jobUrl = page.url();
            const companyName = await page.$eval('.job-details-jobs-unified-top-card__company-name a', 
              el => el.textContent.trim());

            const { error } = await supabase
              .from('job_applications')
              .insert({
                user_id: application.user_id,
                job_title: jobTitle,
                job_url: jobUrl,
                company_name: companyName
              });

            if (error) {
              console.error("Failed to log application:", error);
            } else {
              console.log("📝 Application logged to database");
            }
          }
        } catch (verificationError) {
          console.warn("⚠️ Could not verify application success:", verificationError.message);
        }

        // Close success popup if present
        const dismissButton = await page.$('button[aria-label="Dismiss"][data-test-modal-close-btn]');
        if (dismissButton) {
          await dismissButton.click();
          console.log("🔒 Closed success popup");
          await delay(1000);
        }

        break;
      } else {
        console.log("⛔ No navigation buttons found. Abandoning application.");
        return false;
      }
    }

    console.log("🎉 Form filled and submitted.");
    await delay(2000);
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

    // Filter only applications with LinkedIn credentials
    return applications.filter(app => 
      app.linkedin_email && 
      app.linkedin_password
    );
  } catch (error) {
    console.error('Error reading Excel file:', error);
    throw error;
  }
}

async function checkDailyLimit(userId) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('job_applications')
      .select('id')
      .eq('user_id', userId)
      .gte('applied_at', todayStart.toISOString());

    if (error) {
      console.error('Error checking daily limit:', error);
      return true; // Allow application if we can't check the limit
    }

    const applicationCount = data?.length || 0;
    console.log(`📊 User has submitted ${applicationCount} applications today`);
    
    return applicationCount < MAX_DAILY_APPLICATIONS;
  } catch (err) {
    console.error('Failed to check daily limit:', err);
    return true; // Allow application if check fails
  }
}

async function loginToLinkedin(application, page) {
  try {
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

  } catch (error) {
    console.error('Operation failed:', error);
    if (error.name === 'TimeoutError') {
      console.log('Timeout while waiting for element. Please check if the page loaded correctly.');
    }
    throw error;
  }
}

module.exports = {
  processAllUsers
};