// DeepSeek automation content script

console.log("GEO Testing: DeepSeek content script loaded");

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
      locator = new ElementLocator("deepseek", selectors);
      console.log("DeepSeek locator initialized");
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
    return await locator.locate("sendButton");
  } catch (primaryError) {
    const localButton = inputElement && inputElement.parentElement
      ? inputElement.parentElement.querySelector("button")
      : null;
    if (localButton && isElementVisible(localButton) && !localButton.disabled) {
      return localButton;
    }

    const fallbackButtons = Array.from(
      document.querySelectorAll(
        "button, [role='button'][aria-label], [data-testid*='send'], [class*='send']"
      )
    )
      .filter((el) => isElementVisible(el) && !el.disabled);
    if (fallbackButtons.length > 0) {
      return fallbackButtons[fallbackButtons.length - 1];
    }

    throw primaryError;
  }
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
  const containers = document.querySelectorAll("[role='article'], .message-content");
  if (containers.length === 0) {
    return "";
  }

  const assistantMessages = Array.from(containers).filter((el) => {
    return !el.classList.contains("user-message") &&
      !el.querySelector("[data-role='user']");
  });

  if (assistantMessages.length === 0) {
    return "";
  }

  const lastMessage = assistantMessages[assistantMessages.length - 1];
  return lastMessage.innerText || lastMessage.textContent || "";
}

function getStreamingFingerprint() {
  const containers = Array.from(document.querySelectorAll("[role='article'], .message-content"));

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
  const parts = [
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
  return /(stop|停止|中止|interrupt|cancel generation)/i.test(hint);
}

function isSendControl(button) {
  const hint = getButtonHintText(button);
  if (/(send|发送|submit|arrow-up|up)/i.test(hint)) {
    return true;
  }
  return button.type === "submit";
}

function collectVisibleButtons(scopeRoot) {
  const elements = Array.from(
    scopeRoot.querySelectorAll("button, [role='button'][aria-label], [data-testid*='send']")
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
      return true;
    }

    await sleep(800);
  }

  throw new Error(`Answer timeout after ${maxWaitTime / 1000} seconds`);
}

// Extract answer text from last message
async function extractAnswerText() {
  try {
    const containers = document.querySelectorAll("[role='article'], .message-content");
    if (containers.length === 0) {
      throw new Error("No answer containers found");
    }

    const assistantMessages = Array.from(containers).filter((el) => {
      return !el.classList.contains("user-message") &&
        !el.querySelector("[data-role='user']");
    });

    if (assistantMessages.length === 0) {
      throw new Error("No assistant messages found");
    }

    const lastMessage = assistantMessages[assistantMessages.length - 1];
    return lastMessage.innerText || lastMessage.textContent || "";
  } catch (error) {
    console.error("Failed to extract answer:", error);
    return "";
  }
}

// Request screenshot from background script
async function requestScreenshot() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "captureScreenshot" },
      (response) => {
        resolve(response ? response.screenshot || null : null);
      }
    );
  });
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
    await ensureWebSearchEnabled();

    const input = await locateInputBox();
    await typeText(input, questionData.question);

    const previousFingerprint = getStreamingFingerprint();
    const baselineControlSignature = (await getSubmitControlState(input)).controlSignature;
    const sendMethod = await sendQuestion(input);

    console.log(`Question sent via ${sendMethod}, waiting for answer...`);
    await waitForAnswerComplete(previousFingerprint, input, baselineControlSignature);

    const answerText = await extractAnswerText();
    const screenshot = await requestScreenshot();

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
