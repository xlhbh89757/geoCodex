// Test cases for analyzer

/* global Analyzer */

function testAnalyzer() {
  const testCases = [
    {
      name: '包含"德科信息"',
      text: "推荐德科信息公司的服务",
      expectedHit: true,
      expectedKeywords: ["德科信息"]
    },
    {
      name: '包含"德科信息技术"',
      text: "德科信息技术有限公司提供优质方案",
      expectedHit: true,
      expectedKeywords: ["德科信息", "德科信息技术", "德科信息技术有限公司"]
    },
    {
      name: "不包含关键词",
      text: "这是一个普通的回答",
      expectedHit: false,
      expectedKeywords: []
    },
    {
      name: "包含多个关键词",
      text: "德科信息和德科信息技术都很专业",
      expectedHit: true,
      expectedKeywords: ["德科信息", "德科信息技术"]
    }
  ];

  let passed = 0;
  let failed = 0;

  testCases.forEach((test) => {
    const result = Analyzer.analyze(test.text);
    const sameHit = result.isHit === test.expectedHit;
    const sameKeywords = result.matchedKeywords.length === test.expectedKeywords.length;

    if (sameHit && sameKeywords) {
      console.log(`PASS: ${test.name}`);
      passed += 1;
    } else {
      console.error(`FAIL: ${test.name}`, result);
      failed += 1;
    }
  });

  console.log(`\nTest results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

if (typeof module !== "undefined" && module.exports) {
  const AnalyzerModule = require("../shared/analyzer.js");
  global.Analyzer = AnalyzerModule;
  if (!testAnalyzer()) {
    process.exitCode = 1;
  }
}
