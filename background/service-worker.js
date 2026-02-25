// Background service worker for GEO testing assistant

console.log("GEO Testing Assistant: Service worker initialized");

const DEFAULT_KEYWORDS = ["德科信息", "德科信息技术", "德科信息技术有限公司"];

const PLATFORM_CONFIG = {
  deepseek: {
    url: "https://chat.deepseek.com",
    contentScriptFiles: [
      "shared/element-locator.js",
      "shared/answer-completion.js",
      "content/deepseek.js"
    ]
  },
  doubao: {
    url: "https://www.doubao.com/chat/",
    contentScriptFiles: [
      "shared/element-locator.js",
      "shared/answer-completion.js",
      "content/doubao.js"
    ]
  },
  yuanbao: {
    url: "https://yuanbao.tencent.com/",
    contentScriptFiles: [
      "shared/element-locator.js",
      "shared/answer-completion.js",
      "content/yuanbao.js"
    ]
  }
};

let currentSession = null;

// Open sidepanel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Load session from storage on startup
chrome.runtime.onStartup.addListener(async () => {
  const result = await chrome.storage.local.get("currentSession");
  if (result.currentSession && result.currentSession.status === "running") {
    currentSession = result.currentSession;

    // Show badge to indicate incomplete test
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#FFA500" });
  }
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true; // Keep channel open
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case "startTest":
      return startTest(message.data);
    case "pauseTest":
      return pauseTest();
    case "resumeTest":
      return resumeTest();
    case "captureScreenshot":
      return captureScreenshot(sender.tab ? sender.tab.id : null);
    case "getSession":
      return { session: currentSession };
    default:
      return { success: false, error: "Unknown action" };
  }
}

async function startTest(data) {
  try {
    const { questions, platform, keywords } = data;
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("No questions provided");
    }

    const selectedPlatform = resolvePlatform(platform);
    const selectedKeywords = await resolveKeywords(keywords);

    // Create new session
    currentSession = {
      id: `session_${Date.now()}`,
      status: "running",
      platform: selectedPlatform,
      keywords: selectedKeywords,
      startTime: Date.now(),
      progress: {
        total: questions.length,
        completed: 0,
        currentIndex: 0
      },
      questions,
      results: []
    };

    // Save to storage
    await chrome.storage.local.set({ currentSession });

    const tabUrl = getPlatformConfig(selectedPlatform).url;
    const tab = await getOrCreateTab(tabUrl);
    await ensureTabAndContentReady(tab.id, tabUrl, "", selectedPlatform);

    // Start processing questions
    processNextQuestion(tab.id);

    return { success: true, sessionId: currentSession.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function resolvePlatform(platform) {
  if (platform && PLATFORM_CONFIG[platform]) {
    return platform;
  }
  return "deepseek";
}

function getPlatformConfig(platform) {
  const conf = PLATFORM_CONFIG[resolvePlatform(platform)];
  if (!conf || !conf.url) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return conf;
}

function normalizeKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];

  return keywords
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

async function resolveKeywords(keywordsFromRequest) {
  const fromRequest = normalizeKeywords(keywordsFromRequest);
  if (fromRequest.length > 0) {
    return fromRequest;
  }

  const stored = await chrome.storage.local.get("keywordConfig");
  const fromStorage = normalizeKeywords(stored.keywordConfig);
  if (fromStorage.length > 0) {
    return fromStorage;
  }

  return DEFAULT_KEYWORDS.slice();
}

// Get or create tab for platform
async function getOrCreateTab(url) {
  if (!url) {
    throw new Error("Platform URL is empty");
  }

  const queryPattern = toTabQueryPattern(url);
  const tabs = await chrome.tabs.query({ url: queryPattern });

  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0];
  }

  return chrome.tabs.create({ url, active: true });
}

function toTabQueryPattern(url) {
  const parsed = new URL(url);
  return `${parsed.origin}/*`;
}

async function processNextQuestion(tabId) {
  if (!currentSession || currentSession.status !== "running") {
    return;
  }

  const { questions, progress } = currentSession;
  if (progress.currentIndex >= progress.total) {
    await completeTest();
    return;
  }

  const questionData = questions[progress.currentIndex];

  try {
    const tab = await chrome.tabs.get(tabId);
    const expectedUrl = getPlatformConfig(currentSession.platform).url;
    await ensureTabAndContentReady(tabId, expectedUrl, tab.url, currentSession.platform);

    notifySidepanel({
      action: "questionStarted",
      question: questionData.question,
      index: progress.currentIndex,
      total: progress.total
    });

    const response = await chrome.tabs.sendMessage(tabId, {
      action: "processQuestion",
      questionData
    });

    if (response && response.success) {
      const analysis = analyzeAnswer(response.result.answer, currentSession.keywords);
      const result = {
        ...response.result,
        isHit: analysis.isHit,
        matchedKeywords: analysis.matchedKeywords
      };

      currentSession.results.push(result);
      currentSession.progress.completed += 1;
      currentSession.progress.currentIndex += 1;
      await chrome.storage.local.set({ currentSession });

      notifySidepanel({
        action: "progressUpdate",
        progress: currentSession.progress,
        result
      });

      setTimeout(() => processNextQuestion(tabId), 1000);
    } else {
      await handleError(response ? response.error : "Unknown tab response", questionData);
    }
  } catch (error) {
    await handleError(error.message, questionData);
  }
}

// Analyze answer for keywords
function analyzeAnswer(answerText, keywords) {
  const activeKeywords = normalizeKeywords(keywords).length > 0
    ? normalizeKeywords(keywords)
    : DEFAULT_KEYWORDS;
  const normalizedText = (answerText || "").replace(/\s+/g, "").toLowerCase();
  const matchedKeywords = activeKeywords.filter((keyword) => {
    const normalizedKeyword = keyword.replace(/\s+/g, "").toLowerCase();
    return normalizedText.includes(normalizedKeyword);
  });

  return {
    isHit: matchedKeywords.length > 0,
    matchedKeywords
  };
}

async function captureScreenshot(tabId) {
  try {
    let windowId = null;
    if (tabId) {
      const tab = await chrome.tabs.get(tabId);
      windowId = tab.windowId;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
      quality: 70
    });

    return { screenshot: dataUrl, tabId };
  } catch (error) {
    console.error("Screenshot failed:", error);
    return { screenshot: null };
  }
}

async function pauseTest() {
  if (currentSession && currentSession.status === "running") {
    currentSession.status = "paused";
    await chrome.storage.local.set({ currentSession });
    notifySidepanel({ action: "testPaused" });
    return { success: true };
  }

  return { success: false, error: "No active session" };
}

async function resumeTest() {
  if (currentSession && currentSession.status === "paused") {
    currentSession.status = "running";
    await chrome.storage.local.set({ currentSession });

    const platform = resolvePlatform(currentSession.platform);
    const tabUrl = getPlatformConfig(platform).url;
    const tab = await getOrCreateTab(tabUrl);
    await ensureTabAndContentReady(tab.id, tabUrl, "", platform);

    processNextQuestion(tab.id);
    notifySidepanel({ action: "testResumed" });
    return { success: true };
  }

  return { success: false, error: "No paused session" };
}

async function completeTest() {
  if (!currentSession) return { success: false, error: "No active session" };

  currentSession.status = "completed";
  currentSession.completedTime = Date.now();

  const result = await chrome.storage.local.get("history");
  const history = result.history || [];
  const hitCount = currentSession.results.filter((r) => r.isHit).length;

  const reportData = {
    sessionId: currentSession.id,
    completedTime: currentSession.completedTime,
    platform: currentSession.platform,
    totalQuestions: currentSession.progress.total,
    hitCount,
    hitRate: currentSession.progress.total > 0
      ? (hitCount / currentSession.progress.total).toFixed(4)
      : "0.0000"
  };

  history.unshift(reportData);
  if (history.length > 10) history.splice(10);

  await chrome.storage.local.set({
    currentSession,
    history
  });

  chrome.action.setBadgeText({ text: "" });
  notifySidepanel({ action: "testCompleted" });

  return { success: true };
}

async function handleError(errorMessage, questionData) {
  if (!currentSession) return;

  currentSession.status = "paused";
  await chrome.storage.local.set({ currentSession });

  notifySidepanel({
    action: "error",
    error: errorMessage,
    question: questionData ? questionData.question : ""
  });
}

// Notify sidepanel
function notifySidepanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Sidepanel might not be open, ignore error.
  });
}

async function ensureTabAndContentReady(tabId, expectedUrl, currentTabUrl = "", platform = "deepseek") {
  await waitForTabComplete(tabId, expectedUrl, currentTabUrl);
  await waitForContentScript(tabId, platform);
}

async function waitForTabComplete(tabId, expectedUrl, currentTabUrl = "", timeoutMs = 30000) {
  const expectedOrigin = new URL(expectedUrl).origin;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    const tabUrl = tab.url || currentTabUrl || "";
    const status = tab.status || "";

    if (tabUrl.startsWith(expectedOrigin) && status === "complete") {
      return;
    }

    await sleep(300);
  }

  throw new Error(`Target tab not ready within ${timeoutMs / 1000}s`);
}

async function waitForContentScript(tabId, platform, timeoutMs = 30000) {
  const start = Date.now();
  let injected = false;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: "ping" });
      if (response && response.ready) {
        return;
      }
    } catch (error) {
      const message = error && error.message ? error.message : "";
      if (message.includes("Receiving end does not exist")) {
        // Content scripts are not always present on already-open tabs after extension reload.
        // Try one explicit runtime injection, then continue retry loop.
        if (!injected) {
          await tryInjectContentScripts(tabId, platform);
          injected = true;
        }
      } else {
        throw error;
      }
    }

    await sleep(300);
  }

  throw new Error(`Content script not ready within ${timeoutMs / 1000}s`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryInjectContentScripts(tabId, platform) {
  try {
    const files = getPlatformConfig(platform).contentScriptFiles;
    await chrome.scripting.executeScript({
      target: { tabId },
      files
    });
  } catch (error) {
    console.warn("Content script injection attempt failed:", error);
  }
}
