"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const safetyFilters_1 = require("./services/safetyFilters");
function runSafetyTests() {
    console.log('--- Phase 6 Verification: Safety Filters ---');
    // Deep mocked orderbook: 
    // Alpha signal triggered at $0.50
    const alphaPrice = 0.50;
    const mockOrderBook = {
        bids: [{ price: 0.49, size: 1000 }, { price: 0.48, size: 5000 }],
        asks: [
            { price: 0.50, size: 50 }, // Tick 1: 50 shares * 0.50 = $25 
            { price: 0.51, size: 100 }, // Tick 2: 100 shares * 0.51 = $51
            { price: 0.52, size: 1000 } // Tick 3: 1000 shares * 0.52 = $520
        ]
    };
    /**
     * TEST 1: Passing Trade (Good Spread, Good Liquidity, Good Slippage)
     * Bet Size: $50
     * Expected: Will eat $25 from Tick 1, and $25 from Tick 2.
     * Avg Price should be ~ $0.505
     */
    console.log('\n[Test 1] Passing Trade Simulation');
    const res1 = (0, safetyFilters_1.validateTradeSafety)(mockOrderBook, alphaPrice, 50, // $50 Bet
    300, // Max Spread 3%
    2, // Max slippage $0.02 (meaning max allowed execution is $0.52)
    500 // Min liquidity $500
    );
    console.log('Result:', res1.passed ? 'PASS ✅' : `FAIL ❌ (${res1.reason})`);
    if (res1.passed)
        console.log(`Execution Price: $${res1.executionPrice?.toFixed(4)}, Shares: ${res1.expectedShares?.toFixed(2)}`);
    /**
     * TEST 2: Failing Trade (Exceeds Slippage)
     * Bet Size: $150
     * Expected: Will eat Tick 1 ($25), Tick 2 ($51), and $74 from Tick 3 ($0.52).
     * But wait! If we limit slippage to 1 cent (max execution $0.51), it will fail to fill completely under the limit.
     */
    console.log('\n[Test 2] Slippage Limit Breached Simulation');
    const res2 = (0, safetyFilters_1.validateTradeSafety)(mockOrderBook, alphaPrice, 150, // $150 Bet
    300, // Max Spread 3%
    1, // Max slippage $0.01 (meaning max allowed execution is $0.51)
    100 // Min liquidity $100
    );
    console.log('Result:', res2.passed ? 'PASS ✅' : `FAIL ❌ (${res2.reason})`);
    /**
     * TEST 3: Failing Trade (Spread Limit)
     * Expected: Spread is (0.50 - 0.49) / 0.50 = 2%. If max spread is 1%, it should fail.
     */
    console.log('\n[Test 3] Spread Breached Simulation');
    const res3 = (0, safetyFilters_1.validateTradeSafety)(mockOrderBook, alphaPrice, 10, // $10 Bet
    100, // Max Spread 1% (Will fail, spread is 2%)
    2, // Max slippage $0.02
    100 // Min liquidity $100
    );
    console.log('Result:', res3.passed ? 'PASS ✅' : `FAIL ❌ (${res3.reason})`);
    /**
     * TEST 4: Failing Trade (Liquidity Check)
     * Expected: Total liquidity under the $0.51 max slippage limit is $25 + $51 = $76.
     * If we require $200 min liquidity, it should fail before even trying to execute.
     */
    console.log('\n[Test 4] Min Liquidity Breached Simulation');
    const res4 = (0, safetyFilters_1.validateTradeSafety)(mockOrderBook, alphaPrice, 10, // $10 Bet
    300, // Max Spread 3%
    1, // Max slippage $0.01 (Liquidity up to $0.51 is only $76)
    200 // Min liquidity $200
    );
    console.log('Result:', res4.passed ? 'PASS ✅' : `FAIL ❌ (${res4.reason})`);
}
runSafetyTests();
