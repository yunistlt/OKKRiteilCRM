
// Proof of concept for slice(-7) logic
const phone11 = "79161234567"; // Telphin raw
const phone10 = "9161234567";  // RetailCRM clean

const suffix1 = phone11.slice(-7);
const suffix2 = phone10.slice(-7);

console.log(`Phone 11: ${phone11} -> Last 7: ${suffix1}`);
console.log(`Phone 10: ${phone10} -> Last 7: ${suffix2}`);

if (suffix1 === suffix2) {
    console.log("✅ MATCH! Cutting from the end works perfectly.");
} else {
    console.log("❌ MISMATCH. My math was wrong.");
}

// Corner case: Area code difference?
// 916 123 45 67
// 926 123 45 67
const phoneDiff = "9261234567";
console.log(`\nPhone Diff: ${phoneDiff} -> Last 7: ${phoneDiff.slice(-7)}`);
if (phoneDiff.slice(-7) === suffix1) {
    console.log("⚠️ WARNING: Different area codes match! (Expected behavior for 7-digit match)");
}
