/* ==== DOM REFERENCES ==== */
const loanAmountEl = document.getElementById('loanAmount');
const offsetBalanceEl = document.getElementById('offsetBalance');
const interestRateEl = document.getElementById('interestRate');
const loanTermEl = document.getElementById('loanTerm');
const extraRepaymentEl = document.getElementById('extraRepayment');
const repaymentFrequencyEl = document.getElementById('repaymentFrequency');
const repaymentTypeSelect = document.getElementById('repaymentTypeSelect');

const monthlyRepaymentValueEl = document.getElementById('monthlyRepaymentValue');

// Range sliders
const loanAmountRange = document.getElementById('loanAmountRange');
const offsetBalanceRange = document.getElementById('offsetBalanceRange');
const interestRateRange = document.getElementById('interestRateRange');
const loanTermRange = document.getElementById('loanTermRange');
const extraRepaymentRange = document.getElementById('extraRepaymentRange');

// Summary elements
const summaryRepaymentEl = document.getElementById('summaryRepayment');
const summaryInterestEl = document.getElementById('summaryInterest');
const summaryTotalEl = document.getElementById('summaryTotal');
const summaryTermEl = document.getElementById('summaryTerm');

// Chart
const chartCanvas = document.getElementById('repaymentChart');
let mortgageChart = null;
const chartPeriodSelect = document.getElementById('chartPeriodSelect');
let amortizationData = [];

// Error Message
const errorMessageEl = document.getElementById('errorMessage');

// Reset Button
const resetButton = document.getElementById('resetButton');

/*
  We'll store the user's "base monthly extra" behind the scenes. 
  By default $0 if the user hasn't typed anything. 
*/
let baseExtraMonthly = 0;

/* ==== HELPER FUNCTIONS ==== */
function formatCurrency(num) {
  return num.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  });
}
function parseCurrencyToNumber(str) {
  const numeric = str.replace(/[^0-9.-]/g, '');
  return parseFloat(numeric) || 0;
}
function formatPercentage(num) {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }) + '%';
}
function parsePercentageToNumber(str) {
  const numeric = str.replace(/[^0-9.-]/g, '');
  return parseFloat(numeric) || 0;
}

/* 
   Determine how many payments per year based on frequency.
   monthly=12, fortnightly=26, weekly=52
*/
function getPaymentsPerYear() {
  const freq = repaymentFrequencyEl.value;
  if (freq === 'weekly') {
    return 52;
  }
  if (freq === 'fortnightly') {
    return 26;
  }
  // default monthly
  return 12;
}

/*
   Convert baseExtraMonthly => per-period extra 
   based on the current frequency. 
   e.g. if baseExtraMonthly=300, 
       and user picks fortnightly =>  (300 * 12)/26 = ~138.46
*/
function getPerPeriodExtra() {
  const freq = repaymentFrequencyEl.value;
  const monthly = baseExtraMonthly;

  // if monthly => just monthly
  if (freq === 'monthly') {
    return monthly;
  }
  if (freq === 'fortnightly') {
    return (monthly * 12) / 26;
  }
  if (freq === 'weekly') {
    return (monthly * 12) / 52;
  }
  // fallback
  return monthly;
}

/* 
  Base payment formula. If "interest_only," base is interest each period.
*/
function calculateBasePayment(principal, periodicRate, totalPeriods, repayType) {
  if (repayType === 'interest_only') {
    return principal * periodicRate;
  }
  // P&I
  if (periodicRate === 0) {
    return principal / totalPeriods;
  }
  return (
    principal *
    (periodicRate * Math.pow(1 + periodicRate, totalPeriods)) /
    (Math.pow(1 + periodicRate, totalPeriods) - 1)
  );
}

/*
   Quick naive estimate for "Estimated Repayments" on left panel. 
   We'll use the scaled extra.
*/
function calculateMortgageEstimate() {
  const principal = parseCurrencyToNumber(loanAmountEl.value);
  const offset = parseCurrencyToNumber(offsetBalanceEl.value);
  const interestVal = parsePercentageToNumber(interestRateEl.value);
  const repayType = repaymentTypeSelect.value;
  const periodsPerYear = getPaymentsPerYear();
  const years = parseInt(loanTermEl.value) || 30;

  const effectivePrincipal = Math.max(0, principal - offset);
  const periodicRate = (interestVal / 100) / periodsPerYear;
  const totalPeriods = periodsPerYear * years;

  // scaled extra for the chosen frequency
  const perPeriodExtra = getPerPeriodExtra();

  const basePayment = calculateBasePayment(effectivePrincipal, periodicRate, totalPeriods, repayType);
  const actualPayment = basePayment + perPeriodExtra;

  return {
    basePayment,
    actualPayment,
    termYears: years,
  };
}

/*
   Full period-by-period breakdown, finishing early if extra is high.
*/
function calculateAmortizationBreakdown() {
  const principal = parseCurrencyToNumber(loanAmountEl.value);
  const offset = parseCurrencyToNumber(offsetBalanceEl.value);
  const interestVal = parsePercentageToNumber(interestRateEl.value);
  const repayType = repaymentTypeSelect.value;
  const periodsPerYear = getPaymentsPerYear();
  const years = parseInt(loanTermEl.value) || 30;

  const effectivePrincipal = Math.max(0, principal - offset);
  const periodicRate = (interestVal / 100) / periodsPerYear;
  const totalPeriods = periodsPerYear * years;

  let balance = effectivePrincipal;
  const breakdown = [];

  // scaled extra for the chosen frequency
  const perPeriodExtra = getPerPeriodExtra();

  const basePayment = calculateBasePayment(effectivePrincipal, periodicRate, totalPeriods, repayType);
  const fullPayment = basePayment + perPeriodExtra;

  for (let p = 1; p <= totalPeriods; p++) {
    const interestPaid = balance * periodicRate;

    let principalPaid = 0;
    if (repayType === 'interest_only') {
      const required = interestPaid;
      const additional = Math.max(0, fullPayment - required);
      principalPaid = Math.min(balance, additional);
    } else {
      principalPaid = Math.max(0, fullPayment - interestPaid);
      if (principalPaid > balance) {
        principalPaid = balance;
      }
    }

    balance -= principalPaid;

    breakdown.push({
      period: p,
      interestPaid,
      principalPaid,
      balance: Math.max(balance, 0),
    });

    if (balance <= 0) {
      break;
    }
  }
  return breakdown;
}

/*
   If chart is set to "year," group the period data (weekly/fortnightly/monthly) into yearly sums.
*/
function groupDataByYear(periodData) {
  if (!periodData || periodData.length === 0) return [];

  const grouped = [];
  const periodsPerYear = getPaymentsPerYear();
  let currentYear = 1;
  let yearInterest = 0;
  let yearPrincipal = 0;
  let lastBalance = periodData[0].balance;

  for (let i = 0; i < periodData.length; i++) {
    const row = periodData[i];
    const yearIndex = Math.floor((row.period - 1) / periodsPerYear) + 1;
    if (yearIndex !== currentYear) {
      grouped.push({
        year: currentYear,
        interestPaid: yearInterest,
        principalPaid: yearPrincipal,
        balance: lastBalance,
      });
      currentYear = yearIndex;
      yearInterest = 0;
      yearPrincipal = 0;
    }
    yearInterest += row.interestPaid;
    yearPrincipal += row.principalPaid;
    lastBalance = row.balance;
  }
  grouped.push({
    year: currentYear,
    interestPaid: yearInterest,
    principalPaid: yearPrincipal,
    balance: lastBalance,
  });
  return grouped;
}

/*
   Summarize the breakdown to find total interest, total principal,
   total repayment, and how many periods were actually made.
*/
function getAmortizationSummary(breakdown) {
  let totalInterest = 0;
  let totalPrincipal = 0;

  for (const row of breakdown) {
    totalInterest += row.interestPaid;
    totalPrincipal += row.principalPaid;
  }
  const totalRepayments = totalInterest + totalPrincipal;
  const actualPeriods = breakdown.length;
  const periodsPerYear = getPaymentsPerYear();
  const actualYears = actualPeriods / periodsPerYear;

  return {
    totalInterest,
    totalPrincipal,
    totalRepayments,
    actualPeriods,
    actualYears,
  };
}

/*
   Build or rebuild Chart.js stacked bar
*/
function buildChart() {
    if (mortgageChart) {
        mortgageChart.destroy();
    }
    if (!amortizationData || amortizationData.length === 0) return;

    let labels, interestData, principalData;

    if (chartPeriodSelect.value === 'year') {
        labels = amortizationData.map(d => d.year);
        interestData = amortizationData.map(d => Math.round(d.interestPaid));
        principalData = amortizationData.map(d => Math.round(d.principalPaid));
    } else {
        labels = amortizationData.map(d => d.period);
        interestData = amortizationData.map(d => Math.round(d.interestPaid));
        principalData = amortizationData.map(d => Math.round(d.principalPaid));
    }

    mortgageChart = new Chart(chartCanvas, {
        type: 'bar',
        data: {
        labels,
        datasets: [
            {
            label: 'Interest Paid',
            data: interestData,
            backgroundColor: 'rgba(204, 153, 0, 0.8)',
            borderColor: 'rgba(204, 153, 0, 1)',
            borderWidth: 1,
            },
            {
            label: 'Principal Paid',
            data: principalData,
            backgroundColor: 'rgba(153, 204, 51, 0.8)',
            borderColor: 'rgba(153, 204, 51, 1)',
            borderWidth: 1,
            },
        ],
        },
        options: {
        responsive: true, // Make the chart responsive
        maintainAspectRatio: false, // Allow the chart to scale freely
        scales: {
            x: {
            type: 'category',
            stacked: true,
            display: true,
            },
            y: {
            stacked: true,
            beginAtZero: true,
            },
        },
        plugins: {
            legend: {
            display: false,
            },
            tooltip: {
            callbacks: {
                label: (context) => {
                return `${context.dataset.label}: $${context.parsed.y.toLocaleString()}`;
                },
            },
            },
        },
        },
    });
}

/*
   MAIN UI Update:
   1) Quick naive estimate
   2) Full breakdown
   3) Summarize + fill in the table
   4) Build chart 
*/
function updateUI() {
  try {
    // Clear any previous error messages
    errorMessageEl.textContent = '';

    // 1) quick estimate
    const { actualPayment } = calculateMortgageEstimate();
    monthlyRepaymentValueEl.textContent = '$' + Math.round(actualPayment).toLocaleString();

    // 2) breakdown
    const periodData = calculateAmortizationBreakdown();

    // 3) summarize
    const {
      totalInterest,
      totalRepayments,
      actualYears
    } = getAmortizationSummary(periodData);

    // For "Minimum monthly repayments," we are currently using the actual payment
    summaryRepaymentEl.textContent = '$' + Math.round(actualPayment).toLocaleString();
    summaryInterestEl.textContent = '$' + Math.round(totalInterest).toLocaleString();
    summaryTotalEl.textContent = '$' + Math.round(totalRepayments).toLocaleString();
    summaryTermEl.textContent = actualYears.toFixed(1) + ' years';

    // 4) chart data
    if (chartPeriodSelect.value === 'year') {
      amortizationData = groupDataByYear(periodData);
    } else {
      amortizationData = periodData;
    }
    buildChart();
  } catch (error) {
    errorMessageEl.textContent = 'Error: Invalid input. Please check your values.';
  }
}

/* 
   EVENT LISTENERS
*/

// On user input changes, recalc
loanAmountEl.addEventListener('input', updateUI);
offsetBalanceEl.addEventListener('input', updateUI);
interestRateEl.addEventListener('input', updateUI);
loanTermEl.addEventListener('input', updateUI);
repaymentTypeSelect.addEventListener('change', updateUI);

// The user can change frequency => we recalc 
repaymentFrequencyEl.addEventListener('change', () => {
  // once changed, let's re-run updateUI
  updateUI();
});

// On blur, format currency or percentage
loanAmountEl.addEventListener('blur', handleCurrencyBlur);
offsetBalanceEl.addEventListener('blur', handleCurrencyBlur);
interestRateEl.addEventListener('blur', handlePercentageBlur);

// For the "extraRepayment", we interpret the typed value as monthly
extraRepaymentEl.addEventListener('blur', (e) => {
  const val = parseCurrencyToNumber(e.target.value);
  baseExtraMonthly = val;        // store the user input as monthly base
  e.target.value = formatCurrency(val);
  updateUI();
});

function handleCurrencyBlur(e) {
  const val = parseCurrencyToNumber(e.target.value);
  e.target.value = formatCurrency(val);
  updateUI();
}
function handlePercentageBlur(e) {
  const val = parsePercentageToNumber(e.target.value);
  e.target.value = formatPercentage(val);
  updateUI();
}

// Sliders
loanAmountRange?.addEventListener('input', () => {
  loanAmountEl.value = formatCurrency(parseFloat(loanAmountRange.value));
  updateUI();
});
offsetBalanceRange?.addEventListener('input', () => {
  offsetBalanceEl.value = formatCurrency(parseFloat(offsetBalanceRange.value));
  updateUI();
});
interestRateRange?.addEventListener('input', () => {
  interestRateEl.value = formatPercentage(parseFloat(interestRateRange.value));
  updateUI();
});
loanTermRange?.addEventListener('input', () => {
  loanTermEl.value = loanTermRange.value;
  updateUI();
});
extraRepaymentRange?.addEventListener('input', () => {
  const rawVal = parseFloat(extraRepaymentRange.value) || 0;
  baseExtraMonthly = rawVal;
  extraRepaymentEl.value = formatCurrency(rawVal);
  updateUI();
});

// Chart period
chartPeriodSelect.addEventListener('change', updateUI);

// Reset Button
resetButton.addEventListener('click', () => {
  loanAmountEl.value = '$1,600,000';
  loanAmountRange.value = 1600000;
  offsetBalanceEl.value = '$0';
  offsetBalanceRange.value = 0;
  interestRateEl.value = '6.29%';
  interestRateRange.value = 6.29;
  loanTermEl.value = 30;
  loanTermRange.value = 30;
  extraRepaymentEl.value = '$0';
  extraRepaymentRange.value = 0;
  repaymentFrequencyEl.value = 'monthly';
  repaymentTypeSelect.value = 'principal_interest';
  chartPeriodSelect.value = 'month';
  baseExtraMonthly = 0;
  updateUI();
});

// Sidebar and Content Loading Functions
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.overlay');
  sidebar.classList.toggle('active');
  overlay.style.display = sidebar.classList.contains('active') ? 'block' : 'none';
}

function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.overlay');
  sidebar.classList.remove('active');
  overlay.style.display = 'none';
}

function loadContent(event, link) {
  event.preventDefault();
  const file = link.getAttribute('data-file');
  console.log(`Loading file: ${file}`); // Debugging
  fetch(file)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load file: ${file}`);
      }
      return response.text();
    })
    .then(html => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      let content = doc.body.innerHTML;
      // Remove script tags
      const temp = document.createElement('div');
      temp.innerHTML = content;
      temp.querySelectorAll('script').forEach(script => script.remove());
      content = temp.innerHTML;
      const contentDiv = document.getElementById('content');
      contentDiv.innerHTML = content;
      contentDiv.style.display = 'block';
      // Add close button
      const closeButton = document.createElement('button');
      closeButton.textContent = 'Close';
      closeButton.style.float = 'right';
      closeButton.style.margin = '10px';
      closeButton.addEventListener('click', () => {
        contentDiv.innerHTML = '';
        contentDiv.style.display = 'none';
      });
      contentDiv.appendChild(closeButton);
      closeSidebar();
    })
    .catch(error => {
      console.error('Error loading content:', error);
      document.getElementById('content').innerHTML = `<p>Error loading content: ${error.message}</p>`;
      closeSidebar();
    });
}

// Event Listeners for Sidebar Links
document.querySelectorAll('.sidebar-content a').forEach(link => {
  link.addEventListener('click', (event) => loadContent(event, link));
});

// Init
// Make sure baseExtraMonthly matches what's on page load
baseExtraMonthly = parseCurrencyToNumber(extraRepaymentEl.value);
updateUI();