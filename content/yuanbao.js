// Yuanbao automation content script

console.log("GEO Testing: Yuanbao content script loaded");

const YUANBAO_ANSWER_SELECTOR = "#chat-content > div > div.agent-chat__list__content-wrapper > div.agent-chat__list__content > div.agent-chat__list__item.agent-chat__list__item--ai.agent-chat__list__item--last > div > div.agent-chat__bubble.agent-chat__bubble--ai.agent-chat__conv--ai--multiple > div > div.agent-chat__conv--ai__speech_show > div:nth-child(2) > div";
const YUANBAO_STOP_SELECTOR = "#searchbar-editor > div.style__text-area__wrapper___v8PgB > div.style__text-area__end___ow95N > div:nth-child(2) > div > a";

let locator;
let isProcessing = false;
let initPromise = null;

// Initialize locator
async function init() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const response = await fetch(chrome.runtime.getURL("config/selectors.json"));
      const selectors = await response.json();
      locator = new ElementLocator("yuanbao", selectors);
      console.log("Yuanbao locator initialized");
    } catch (error) {
      console.error("Failed to initialize locator:", error);
      throw error;
    }
  })();

  return initPromise;
}

// Sleep helper
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Type text into input
async function typeText(element, text) {
  element.focus();

  if (element instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    if (setter) {
      setter.call(element, text);
    } else {
      element.value = text;
    }
  } else if (element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    if (setter) {
      setter.call(element, text);
    } else {
      element.value = text;
    }
  } else if (element.isContentEditable) {
    // execCommand works more reliably on some rich text editors.
    const usedExecCommand = typeof document.execCommand === "function" &&
      document.execCommand("insertText", false, text);
    if (!usedExecCommand) {
      element.textContent = text;
    }
  }

  // Trigger common input/change events used by reactive frameworks.
  const inputEvent = new Event("input", { bubbles: true });
  const changeEvent = new Event("change", { bubbles: true });
  element.dispatchEvent(inputEvent);
  element.dispatchEvent(changeEvent);
  await sleep(500);
}

function isElementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    rect.width > 0 &&
    rect.height > 0;
}

function canTypeInto(element) {
  if (!element) return false;
  if (element.matches("textarea, input[type='text'], input:not([type])")) {
    return !element.disabled && !element.readOnly;
  }
  return element.isContentEditable;
}

async function locateInputBox() {
  try {
    return await locator.locate("inputBox");
  } catch (primaryError) {
    const fallbackCandidates = Array.from(
      document.querySelectorAll("textarea, div[contenteditable='true'], input[type='text']")
    ).filter((el) => isElementVisible(el) && canTypeInto(el));

    if (fallbackCandidates.length > 0) {
      // Prefer the last visible input in chat UIs (usually the active composer).
      return fallbackCandidates[fallbackCandidates.length - 1];
    }

    throw primaryError;
  }
}

async function locateSendButton(inputElement) {
  try {
    const candidate = await locator.locate("sendButton");
    if (candidate && isElementVisible(candidate) && !candidate.disabled && !isFullscreenControl(candidate)) {
      return candidate;
    }
  } catch (error) {
    // Fall through to robust heuristics below.
  }
  const localButtons = inputElement && inputElement.parentElement
    ? Array.from(inputElement.parentElement.querySelectorAll("button, [role='button']"))
    : [];
  const localSend = localButtons.filter((el) =>
    isElementVisible(el) &&
    !el.disabled &&
    !isFullscreenControl(el) &&
    isSendControl(el)
  );
  if (localSend.length > 0) {
    return localSend[localSend.length - 1];
  }
  if (inputElement && typeof inputElement.closest === "function") {
    const form = inputElement.closest("form");
    if (form) {
      const formButtons = Array.from(form.querySelectorAll("button, [role='button']"))
        .filter((el) =>
          isElementVisible(el) &&
          !el.disabled &&
          !isFullscreenControl(el) &&
          isSendControl(el)
        );
      if (formButtons.length > 0) {
        return formButtons[formButtons.length - 1];
      }
    }
  }
  const fallbackButtons = Array.from(
    document.querySelectorAll(
      "button, a, [role='button'][aria-label], #yuanbao-send-btn, [data-testid*='send'], [class*='send'], [class*='send-btn-wrapper']"
    )
  ).filter((el) =>
    isElementVisible(el) &&
    !el.disabled &&
    !isFullscreenControl(el) &&
    isSendControl(el)
  );
  if (fallbackButtons.length > 0) {
    return fallbackButtons[fallbackButtons.length - 1];
  }
  throw new Error("No valid send button found");
}

function submitByKeyboard(inputElement, ctrlKey) {
  if (!inputElement) return;
  inputElement.focus();

  const eventInit = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    ctrlKey
  };

  inputElement.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  inputElement.dispatchEvent(new KeyboardEvent("keypress", eventInit));
  inputElement.dispatchEvent(new KeyboardEvent("keyup", eventInit));
}

function submitByForm(inputElement) {
  if (!inputElement || !inputElement.closest) return false;
  const form = inputElement.closest("form");
  if (!form) return false;

  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
    return true;
  }

  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return true;
}

async function sendQuestion(inputElement) {
  try {
    const sendBtn = await locateSendButton(inputElement);
    sendBtn.click();
    return "button";
  } catch (error) {
    console.info("Send button not found, trying form/keyboard fallback.");
  }

  if (submitByForm(inputElement)) {
    return "form";
  }

  submitByKeyboard(inputElement, false);
  await sleep(150);
  submitByKeyboard(inputElement, true);
  return "keyboard";
}

function getLatestAssistantText() {
  const text = extractLatestAssistantTextFromDom();
  return text || "";
}

function getStreamingFingerprint() {
  const containers = Array.from(
    document.querySelectorAll(`${YUANBAO_ANSWER_SELECTOR}, [role='article'], .message-content, .markdown`)
  );

  if (containers.length > 0) {
    const tailTexts = containers
      .slice(-4)
      .map((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (tailTexts.length > 0) {
      return tailTexts.join(" || ");
    }
  }

  // Fallback: use body tail text to detect streaming changes.
  const bodyText = (document.body && document.body.innerText) ? document.body.innerText : "";
  return bodyText.slice(-3000).replace(/\s+/g, " ").trim();
}

function getButtonHintText(button) {
  const testId = button.getAttribute("data-testid") || "";
  const parts = [
    testId,
    button.getAttribute("aria-label") || "",
    button.getAttribute("title") || "",
    button.getAttribute("data-testid") || "",
    button.textContent || "",
    button.className || ""
  ];
  return parts.join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

function isStopControl(button) {
  const hint = getButtonHintText(button);
  const testId = String(button && button.getAttribute ? button.getAttribute("data-testid") || "" : "");
  if (testId === "chat_input_local_break_button") {
    return true;
  }
  if (button && typeof button.matches === "function" && button.matches(YUANBAO_STOP_SELECTOR)) {
    return true;
  }
  const className = String(button && button.className ? button.className : "");
  if (className.includes("break-btn-fISNgC")) {
    return true;
  }
  return /(stop|停止|中止|interrupt|cancel generation)/i.test(hint);
}
function isFullscreenControl(button) {
  const hint = getButtonHintText(button);
  return /(full[\s-]?screen|exit full|enter full|\u5168\u5c4f|\u9000\u51fa\u5168\u5c4f|image viewer|lightbox)/i.test(hint);
}

function isSendControl(button) {
  const hint = getButtonHintText(button);
  const testId = String(button && button.getAttribute ? button.getAttribute("data-testid") || "" : "");
  if (testId === "chat_input_send_button") {
    return true;
  }
  if (button && button.id === "yuanbao-send-btn") {
    return true;
  }
  const className = String(button && button.className ? button.className : "");
  if (className.includes("send-btn-wrapper")) {
    return true;
  }
  if (/(send|发送|submit|arrow-up|up)/i.test(hint)) {
    return true;
  }
  return button.type === "submit";
}

function collectVisibleButtons(scopeRoot) {
  const elements = Array.from(
    scopeRoot.querySelectorAll(
      "button, a, [role='button'][aria-label], #yuanbao-send-btn, [data-testid='chat_input_send_button'], [data-testid='chat_input_local_break_button'], [data-testid*='send'], [class*='send-btn-wrapper'], [class*='break-btn']"
    )
  );
  return elements.filter((el) => isElementVisible(el));
}

function getButtonSignature(button) {
  if (!button) return "";
  const iconPath = button.querySelector("svg path")?.getAttribute("d") || "";
  const disabled = button.disabled ? "1" : "0";
  return [
    disabled,
    button.getAttribute("aria-label") || "",
    button.getAttribute("title") || "",
    button.getAttribute("data-testid") || "",
    button.className || "",
    iconPath
  ].join("||");
}

function pickPrimaryActionButton(inputElement, scopedButtons, globalButtons) {
  const preferred = scopedButtons.length > 0 ? scopedButtons : globalButtons;
  if (preferred.length === 0) {
    return null;
  }

  if (inputElement && typeof inputElement.getBoundingClientRect === "function") {
    const inputRect = inputElement.getBoundingClientRect();
    const anchorX = inputRect.left + inputRect.width / 2;
    const anchorY = inputRect.top + inputRect.height / 2;
    const scored = preferred.map((button) => {
      const rect = button.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = centerX - anchorX;
      const dy = centerY - anchorY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return { button, distance };
    });

    scored.sort((a, b) => a.distance - b.distance);
    if (scored.length > 0) {
      return scored[0].button;
    }
  }

  const enabledPreferred = preferred.filter((button) => !button.disabled);
  if (enabledPreferred.length > 0) {
    return enabledPreferred[enabledPreferred.length - 1];
  }

  // If all are disabled, still return the last control for state tracking.
  return preferred[preferred.length - 1];
}

async function getSubmitControlState(inputElement) {
  let hasStopButton = false;
  let hasSendButton = false;
  let controlSignature = "";

  try {
    const stopBtn = await locator.locate("stopButton", 200);
    hasStopButton = !!(stopBtn && locator.isVisible(stopBtn));
  } catch (error) {
    hasStopButton = false;
  }

  const scopedRoot = inputElement && inputElement.closest
    ? (inputElement.closest("form") || inputElement.parentElement || document)
    : document;

  const scopedButtons = collectVisibleButtons(scopedRoot);
  const globalButtons = scopedRoot === document ? scopedButtons : collectVisibleButtons(document);
  const allButtons = scopedRoot === document
    ? scopedButtons
    : scopedButtons.concat(globalButtons);

  const primaryButton = pickPrimaryActionButton(inputElement, scopedButtons, globalButtons);
  if (primaryButton) {
    controlSignature = getButtonSignature(primaryButton);
  }

  for (const button of allButtons) {
    if (isStopControl(button)) {
      hasStopButton = true;
      continue;
    }
    if (!button.disabled && isSendControl(button)) {
      hasSendButton = true;
    }
  }

  return { hasStopButton, hasSendButton, controlSignature };
}

// Ensure web search is enabled
async function ensureWebSearchEnabled() {
  try {
    const toggle = await locator.locate("webSearchToggle", 3000);

    if (toggle) {
      const isEnabled = toggle.getAttribute("aria-pressed") === "true" ||
        toggle.classList.contains("active");

      if (!isEnabled) {
        console.log("Enabling web search...");
        toggle.click();
        await sleep(500);
      } else {
        console.log("Web search already enabled");
      }
    }
  } catch (error) {
    console.info("Web search toggle not found, continuing without explicit toggle.");
    // Continue anyway - might be enabled by default.
  }
}
function normalizeForCompare(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function isComposerArea(element) {
  if (!element || !element.closest) return false;
  return !!(
    element.closest("form textarea") ||
    element.closest("[contenteditable='true']") ||
    element.closest("[role='textbox']") ||
    element.closest("[class*='input']") ||
    element.closest("[class*='composer']")
  );
}

function isLikelyUserMessage(element) {
  if (!element) return false;

  const attrs = [
    element.getAttribute("data-role") || "",
    element.getAttribute("data-message-author-role") || "",
    element.getAttribute("aria-label") || "",
    element.className || ""
  ].join(" ").toLowerCase();

  return /user|human|\u7528\u6237/.test(attrs);
}

function extractLatestAssistantTextFromDom() {
  const selectors = [
    YUANBAO_ANSWER_SELECTOR,
    "div[data-testid='message_text_content']",
    "[data-message-author-role='assistant']",
    "[role='article']",
    ".message-content",
    ".ds-markdown",
    ".markdown",
    "[class*='assistant']",
    "[class*='answer']"
  ];

  const candidates = [];
  for (const selector of selectors) {
    const matched = Array.from(document.querySelectorAll(selector));
    for (const node of matched) {
      if (!node || !isElementVisible(node)) continue;
      if (isComposerArea(node)) continue;
      if (isLikelyUserMessage(node)) continue;

      const text = normalizeForCompare(node.innerText || node.textContent || "");
      if (!text) continue;
      candidates.push({ node, text });
    }
  }

  if (candidates.length === 0) {
    return "";
  }

  return candidates[candidates.length - 1].text;
}
async function dismissImageFullscreen() {
  let changed = false;
  if (document.fullscreenElement && document.exitFullscreen) {
    try {
      await document.exitFullscreen();
      changed = true;
    } catch (error) {
      // Ignore and continue best-effort close.
    }
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
  const candidates = Array.from(
    document.querySelectorAll("button, [role='button'], [aria-label], [title]")
  ).filter((el) => isElementVisible(el) && !el.disabled);
  for (const button of candidates) {
    if (!isFullscreenControl(button)) {
      continue;
    }
    button.click();
    changed = true;
    await sleep(120);
  }
  if (changed) {
    await sleep(350);
  }
}

// Wait for answer to complete
async function waitForAnswerComplete(
  baselineFingerprint,
  inputElement,
  baselineControlSignature,
  maxWaitTime = 120000
) {
  const startTime = Date.now();
  const tracker = createAnswerCompletionTracker({
    baselineText: baselineFingerprint,
    baselineControlSignature,
    minObserveMs: 2500,
    minStableMs: 1800,
    minNoStopAfterSeenMs: 900,
    minStableAfterStopMs: 500,
    minControlReturnMs: 600,
    hardFallbackMs: 30000
  });
  console.log("Waiting for answer to complete...");

  while (Date.now() - startTime < maxWaitTime) {
    const controlState = await getSubmitControlState(inputElement);
    const state = tracker.update({
      now: Date.now(),
      hasStopButton: controlState.hasStopButton,
      hasSendButton: controlState.hasSendButton,
      controlSignature: controlState.controlSignature,
      answerText: getStreamingFingerprint()
    });

    if (state.isComplete) {
      console.log("Answer completed");
      return state;
    }

    await sleep(800);
  }

  throw new Error(`Answer timeout after ${maxWaitTime / 1000} seconds`);
}

// Extract answer text from last message
async function extractAnswerText() {
  try {
    return extractLatestAssistantTextFromDom();
  } catch (error) {
    console.error("Failed to extract answer:", error);
    return "";
  }
}

// Request screenshot from background script
async function requestScreenshot() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await dismissImageFullscreen();
    const screenshot = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "captureScreenshot" },
        (response) => {
          resolve(response ? response.screenshot || null : null);
        }
      );
    });
    if (screenshot) {
      return screenshot;
    }
    await sleep(400 * attempt);
  }
  return null;
}

// Process a single question
async function processQuestion(questionData) {
  if (isProcessing) {
    throw new Error("Already processing a question");
  }

  await init();
  isProcessing = true;

  try {
    console.log("Processing question:", questionData.question);
    await dismissImageFullscreen();
    await ensureWebSearchEnabled();

    const input = await locateInputBox();
    await typeText(input, questionData.question);

    const previousAnswerText = getLatestAssistantText();
    const previousFingerprint = getStreamingFingerprint();
    const baselineControlSignature = (await getSubmitControlState(input)).controlSignature;
    const sendMethod = await sendQuestion(input);

    console.log(`Question sent via ${sendMethod}, waiting for answer...`);
    const completionState = await waitForAnswerComplete(
      previousFingerprint,
      input,
      baselineControlSignature
    );

    await dismissImageFullscreen();
    let answerText = await extractAnswerText();
    const screenshot = await requestScreenshot();
    const normalizedPrevAnswer = normalizeForCompare(previousAnswerText);
    const normalizedAnswer = normalizeForCompare(answerText);
    const hasNewTextAnswer = !!normalizedAnswer && normalizedAnswer !== normalizedPrevAnswer;
    const hasScreenshot = !!screenshot;
    const sawStreamingChange = !!(completionState && completionState.observedNewAnswer);

    if (!hasNewTextAnswer && sawStreamingChange) {
      const fp = normalizeForCompare(getStreamingFingerprint());
      if (fp && fp !== normalizeForCompare(previousFingerprint)) {
        answerText = fp;
      }
    }

    if (!hasNewTextAnswer && !hasScreenshot && !sawStreamingChange) {
      throw new Error("No new assistant answer detected for current question");
    }

    return {
      questionId: questionData.id,
      question: questionData.question,
      category: questionData.category,
      answer: answerText,
      screenshot,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error("Error processing question:", error);
    throw error;
  } finally {
    isProcessing = false;
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({ ready: true });
    return false;
  }

  if (message.action === "processQuestion") {
    processQuestion(message.questionData)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep channel open for async response.
  }

  return false;
});

init().catch(() => {
  // Initialization errors are surfaced when processQuestion is invoked.
});





