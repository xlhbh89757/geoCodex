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
async function waitForAnswerComplete(maxWaitTime = 120000) {
  const startTime = Date.now();
  console.log("Waiting for answer to complete...");

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const stopBtn = await locator.locate("stopButton", 500);
      if (!stopBtn || !locator.isVisible(stopBtn)) {
        await sleep(2000);
        const doubleCheck = await locator.locate("stopButton", 500);
        if (!doubleCheck || !locator.isVisible(doubleCheck)) {
          console.log("Answer completed");
          return true;
        }
      }
    } catch (error) {
      // Stop button not found - answer likely complete.
      await sleep(2000);
      return true;
    }

    await sleep(1000);
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

    const sendMethod = await sendQuestion(input);

    console.log(`Question sent via ${sendMethod}, waiting for answer...`);
    await waitForAnswerComplete();

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
