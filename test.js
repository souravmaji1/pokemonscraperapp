// test-scraper.js - Test file for the Target checkout scraper

const { runScraper } = require('./scraper-target');

// Test configuration
const testConfig = {
  // Product URL to test checkout flow
  productUrl: 'https://www.target.com/p/pokemon-card-game-mega-high-class-pack-mega-dream-ex-pack-10-cards/-/A-1007918679#lnk=sametab',
  
  // Login credentials
  email: 't19939345@gmail.com',
  password: 'Nandamaji1@',
  
  // Shipping information (only needed if not already saved on account)
  shipping: {
    firstName: 'Lerry',
    lastName: 'Paige',
    address1: '120 W Country Club Blvd',
    city: 'Big Bear City',
    state: 'CA',
    zip: '92314',
    phone: '123-455-6765'
  },
  
  // Payment card details (for CVV confirmation and fallback)
  card: {
    number: '4111111111111111',
    expMonth: '12',
    expYear: '2026',
    cvv: '123',
    nameOnCard: 'Lerry Paige'
  }
};



/**
 * Test 1: Basic Test with Default Config
 * Tests the complete flow with the primary test configuration
 */
async function testBasicFlow() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Basic Checkout Flow');
  console.log('='.repeat(60) + '\n');

  try {
    const result = await runScraper(testConfig);
    
    console.log('\n--- Test 1 Results ---');
    console.log('Status:', result.success ? 'PASSED ✅' : 'FAILED ❌');
    if (result.error) {
      console.log('Error:', result.error);
    }
    if (result.stopped) {
      console.log('Stopped by user');
    }
    
    return result;
  } catch (error) {
    console.error('Test 1 failed with error:', error.message);
    return { success: false, error: error.message };
  }
}



  testBasicFlow()