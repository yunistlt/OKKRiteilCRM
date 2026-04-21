import fs from 'fs';
import path from 'path';
import { evaluateLegalContractText } from '../lib/legal-evaluator';

const FIXTURE_PATH = path.join(__dirname, 'legal_agent_real_cases.fixture.json');

function runRegression() {
  const cases = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
  let passed = 0;
  let failed = 0;
  for (const testCase of cases) {
    const result = evaluateLegalContractText(testCase.text);
    const foundIds = result.issues.map((i) => i.id).sort();
    const expectedIds = (testCase.expected_issues || []).map((i) => i.id).sort();
    const pass = JSON.stringify(foundIds) === JSON.stringify(expectedIds);
    if (pass) {
      passed++;
      console.log(`✅ ${testCase.title}`);
    } else {
      failed++;
      console.log(`❌ ${testCase.title}`);
      console.log('  Ожидалось:', expectedIds);
      console.log('  Найдено:', foundIds);
    }
  }
  console.log(`\nИтого: ${passed} успешных, ${failed} провалено, всего ${cases.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

runRegression();
