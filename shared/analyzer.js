// Keyword analyzer for GEO testing

const KEYWORDS = ["德科信息", "德科信息技术", "德科信息技术有限公司"];

const Analyzer = {
  // Analyze answer for keyword hits
  analyze(answerText) {
    if (!answerText) {
      return {
        isHit: false,
        matchedKeywords: []
      };
    }

    // Normalize text (remove spaces and convert to lowercase)
    const normalizedText = answerText.replace(/\s+/g, "").toLowerCase();

    // Check each keyword
    const matchedKeywords = KEYWORDS.filter((keyword) => {
      const normalizedKeyword = keyword.replace(/\s+/g, "").toLowerCase();
      return normalizedText.includes(normalizedKeyword);
    });

    return {
      isHit: matchedKeywords.length > 0,
      matchedKeywords
    };
  },

  // Generate report from results
  generateReport(results) {
    const totalQuestions = results.length;
    const hitCount = results.filter((r) => r.isHit).length;
    const hitRate = totalQuestions > 0
      ? (hitCount / totalQuestions * 100).toFixed(2)
      : "0.00";

    return {
      summary: {
        totalQuestions,
        hitCount,
        missCount: totalQuestions - hitCount,
        hitRate: `${hitRate}%`
      },
      details: results.map((r) => ({
        questionId: r.questionId,
        question: r.question,
        category: r.category,
        isHit: r.isHit,
        matchedKeywords: r.matchedKeywords || [],
        screenshot: r.screenshot,
        answer: r.answer,
        timestamp: r.timestamp
      }))
    };
  }
};

if (typeof window !== "undefined") {
  window.Analyzer = Analyzer;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = Analyzer;
}
