// DeepSeek automation content script

console.log("GEO Testing: DeepSeek content script loaded");

let locator;
let isProcessing = false;
let initPromise = null;
const DIAGNOSTIC_LOG_INTERVAL_MS = 5000;
const ASSISTANT_TEXT_SELECTOR_GROUPS = [
  ["div[data-testid='message_text_content']"],
  [
    "[data-message-author-role='assistant'] .ds-markdown",
    "[data-message-author-role='assistant'] .markdown",
    "[data-message-author-role='assistant']"
  ],
  [
    "[role='article'] .ds-markdown",
    "[role='article'] .markdown",
    ".message-content .ds-markdown",
    ".message-content .markdown"
  ],
  [
    ".ds-markdown",
    ".markdown",
    ".message-content",
    "[role='article']",
    "[class*='assistant']",
    "[class*='answer']"
  ]
];

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

function summarizeSignature(signature) {
  if (!signature) return "";
  return String(signature).replace(/\s+/g, " ").trim().slice(0, 160);
}

function buildDiagnosticSnapshot(controlState, trackerState, baselineControlSignature, fingerprint) {
  return {
    elapsedMs: trackerState ? trackerState.elapsed : 0,
    stableMs: trackerState ? trackerState.stableMs : 0,
    observedNewAnswer: !!(trackerState && trackerState.observedNewAnswer),
    sawStopButton: !!(trackerState && trackerState.sawStopButton),
    hasStopButton: !!(controlState && controlState.hasStopButton),
    hasSendButton: !!(controlState && controlState.hasSendButton),
    controlChanged: !!(
      baselineControlSignature &&
      controlState &&
      controlState.controlSignature &&
      controlState.controlSignature !== baselineControlSignature
    ),
    controlSignature: summarizeSignature(controlState ? controlState.controlSignature : ""),
    baselineControlSignature: summarizeSignature(baselineControlSignature),
    fingerprintLength: fingerprint ? fingerprint.length : 0
  };
}

function logDiagnostic(phase, snapshot) {
  console.log(`[GEO][deepseek] ${phase}`, snapshot);
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

async function clearText(element) {
  element.focus();

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(element, "");
    } else {
      element.value = "";
    }
  } else if (element.isContentEditable) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const cleared = typeof document.execCommand === "function" &&
      document.execCommand("delete", false);
    if (!cleared) {
      element.textContent = "";
    }
    selection.removeAllRanges();
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(250);
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
      "button, [role='button'][aria-label], [data-testid*='send'], [class*='send']"
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

function getInputValueSnapshot(inputElement) {
  if (!inputElement) return "";
  if (inputElement instanceof HTMLTextAreaElement || inputElement instanceof HTMLInputElement) {
    return normalizeForCompare(inputElement.value || "");
  }
  if (inputElement.isContentEditable) {
    return normalizeForCompare(inputElement.innerText || inputElement.textContent || "");
  }
  return "";
}

async function waitForSubmissionStart(
  inputElement,
  baselineFingerprint,
  baselineControlSignature,
  timeoutMs = 4000
) {
  const start = Date.now();
  let lastSnapshot = null;
  while (Date.now() - start < timeoutMs) {
    const controlState = await getSubmitControlState(inputElement);
    const currentFingerprint = normalizeForCompare(getStreamingFingerprint());
    const inputValue = getInputValueSnapshot(inputElement);
    const controlChanged = !!controlState.controlSignature &&
      controlState.controlSignature !== baselineControlSignature;
    lastSnapshot = {
      elapsedMs: Date.now() - start,
      hasStopButton: controlState.hasStopButton,
      hasSendButton: controlState.hasSendButton,
      controlChanged,
      inputValueLength: inputValue.length,
      fingerprintChanged: !!(currentFingerprint && currentFingerprint !== normalizeForCompare(baselineFingerprint)),
      controlSignature: summarizeSignature(controlState.controlSignature),
      baselineControlSignature: summarizeSignature(baselineControlSignature)
    };

    if (
      controlState.hasStopButton ||
      controlChanged ||
      (!inputValue) ||
      (currentFingerprint && currentFingerprint !== normalizeForCompare(baselineFingerprint))
    ) {
      logDiagnostic("submission-start-detected", lastSnapshot);
      return true;
    }

    await sleep(200);
  }

  logDiagnostic("submission-start-timeout", lastSnapshot || {
    elapsedMs: timeoutMs,
    baselineControlSignature: summarizeSignature(baselineControlSignature)
  });
  return false;
}

async function ensureQuestionSubmissionStarted(inputElement, baselineFingerprint, baselineControlSignature) {
  if (await waitForSubmissionStart(inputElement, baselineFingerprint, baselineControlSignature)) {
    return;
  }

  console.warn("Submission not detected after initial send, retrying with keyboard fallback.");
  submitByKeyboard(inputElement, false);
  await sleep(150);
  submitByKeyboard(inputElement, true);

  if (await waitForSubmissionStart(inputElement, baselineFingerprint, baselineControlSignature, 5000)) {
    return;
  }

  throw new Error("Question submission did not start");
}

async function submitQuestionWithRetry(inputElement, questionText, previousFingerprint, maxAttempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logDiagnostic("submission-attempt", { attempt, maxAttempts });
    if (attempt > 1) {
      console.warn(`Retrying question submission (${attempt}/${maxAttempts})`);
      await dismissImageFullscreen();
      await clearText(inputElement);
      await typeText(inputElement, questionText);
      await sleep(300 * attempt);
    }

    const baselineControlSignature = (await getSubmitControlState(inputElement)).controlSignature;
    const sendMethod = await sendQuestion(inputElement);

    try {
      await ensureQuestionSubmissionStarted(
        inputElement,
        previousFingerprint,
        baselineControlSignature
      );

      return { sendMethod, baselineControlSignature };
    } catch (error) {
      lastError = error;
      logDiagnostic("submission-attempt-failed", {
        attempt,
        maxAttempts,
        error: error.message
      });
      await sleep(600 * attempt);
    }
  }

  throw lastError || new Error("Question submission did not start");
}

function getLatestAssistantText() {
  const text = extractLatestAssistantTextFromDom();
  return text || "";
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
function isOpenFullscreenControl(button) {
  const hint = getButtonHintText(button);
  return /(enter full|full[\s-]?screen|\u5168\u5c4f|image viewer|lightbox)/i.test(hint) &&
    !/(exit full|close|dismiss|\u5173\u95ed|\u9000\u51fa\u5168\u5c4f)/i.test(hint);
}

function isCloseFullscreenControl(button) {
  const hint = getButtonHintText(button);
  return /(exit full|close|dismiss|\u5173\u95ed|\u9000\u51fa\u5168\u5c4f)/i.test(hint);
}

function isFullscreenControl(button) {
  return isOpenFullscreenControl(button) || isCloseFullscreenControl(button);
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
function normalizeForCompare(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function getNodeDepth(node) {
  let depth = 0;
  let current = node;
  while (current && current.parentElement) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
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

function compareNodePosition(a, b) {
  if (a === b) return 0;
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function shouldPreferAssistantEntry(candidate, existing) {
  if (!existing) return true;
  if (candidate.priority !== existing.priority) {
    return candidate.priority < existing.priority;
  }
  if (candidate.depth !== existing.depth) {
    return candidate.depth > existing.depth;
  }
  return candidate.text.length < existing.text.length;
}

function collectAssistantTextEntries() {
  for (let groupIndex = 0; groupIndex < ASSISTANT_TEXT_SELECTOR_GROUPS.length; groupIndex += 1) {
    const selectors = ASSISTANT_TEXT_SELECTOR_GROUPS[groupIndex];
    const byText = new Map();

    for (const selector of selectors) {
      const matched = Array.from(document.querySelectorAll(selector));
      for (const node of matched) {
        if (!node || !isElementVisible(node)) continue;
        if (isComposerArea(node)) continue;
        if (isLikelyUserMessage(node)) continue;

        const text = normalizeForCompare(node.innerText || node.textContent || "");
        if (!text) continue;

        const entry = {
          node,
          text,
          priority: groupIndex + 1,
          depth: getNodeDepth(node),
          selector
        };
        const existing = byText.get(text);
        if (shouldPreferAssistantEntry(entry, existing)) {
          byText.set(text, entry);
        }
      }
    }

    const entries = Array.from(byText.values()).sort((a, b) => compareNodePosition(a.node, b.node));
    if (entries.length > 0) {
      return entries;
    }
  }

  return [];
}

function captureAssistantSnapshot() {
  const entries = collectAssistantTextEntries();
  return {
    entries,
    nodes: entries.map((entry) => entry.node),
    textsByNode: new Map(entries.map((entry) => [entry.node, entry.text])),
    latestText: entries.length > 0 ? entries[entries.length - 1].text : ""
  };
}

function stripBaselinePrefix(currentText, baselineText) {
  const normalizedCurrent = normalizeForCompare(currentText);
  const normalizedBaseline = normalizeForCompare(baselineText);

  if (!normalizedCurrent || !normalizedBaseline || normalizedCurrent === normalizedBaseline) {
    return "";
  }

  if (normalizedCurrent.startsWith(normalizedBaseline)) {
    return normalizedCurrent
      .slice(normalizedBaseline.length)
      .replace(/^[\s|,:;，。；]+/, "")
      .trim();
  }

  return "";
}

function extractAssistantAnswerAfterSnapshot(snapshot) {
  const currentEntries = collectAssistantTextEntries();
  if (currentEntries.length === 0) {
    return { text: "", source: "none" };
  }

  const baselineNodes = new Set((snapshot && snapshot.nodes) || []);
  const baselineTextsByNode = snapshot && snapshot.textsByNode ? snapshot.textsByNode : new Map();

  const newEntries = currentEntries.filter((entry) => !baselineNodes.has(entry.node));
  if (newEntries.length > 0) {
    const latestNewEntry = newEntries[newEntries.length - 1];
    return { text: latestNewEntry.text, source: "new-node" };
  }

  const changedEntries = currentEntries
    .map((entry) => ({
      entry,
      previousText: baselineTextsByNode.get(entry.node) || ""
    }))
    .filter(({ entry, previousText }) => previousText && entry.text !== previousText);

  if (changedEntries.length > 0) {
    const latestChanged = changedEntries[changedEntries.length - 1];
    const deltaText = stripBaselinePrefix(latestChanged.entry.text, latestChanged.previousText);
    return {
      text: deltaText || latestChanged.entry.text,
      source: deltaText ? "changed-node-delta" : "changed-node-full"
    };
  }

  const latestText = currentEntries[currentEntries.length - 1].text;
  if (latestText && latestText !== ((snapshot && snapshot.latestText) || "")) {
    const deltaText = stripBaselinePrefix(latestText, snapshot ? snapshot.latestText : "");
    return {
      text: deltaText || latestText,
      source: deltaText ? "latest-delta" : "latest-full"
    };
  }

  return { text: "", source: "unchanged" };
}

function extractLatestAssistantTextFromDom() {
  const entries = collectAssistantTextEntries();
  if (entries.length === 0) {
    return "";
  }

  return entries[entries.length - 1].text;
}

function logAnswerExtraction(snapshot, extraction) {
  logDiagnostic("answer-extraction", {
    baselineCount: snapshot && snapshot.entries ? snapshot.entries.length : 0,
    currentCount: collectAssistantTextEntries().length,
    source: extraction ? extraction.source : "",
    answerLength: extraction && extraction.text ? extraction.text.length : 0
  });
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
    if (!isCloseFullscreenControl(button)) {
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
  let lastDiagnosticLogAt = 0;
  let lastSnapshot = null;
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
    const fingerprint = getStreamingFingerprint();
    const state = tracker.update({
      now: Date.now(),
      hasStopButton: controlState.hasStopButton,
      hasSendButton: controlState.hasSendButton,
      controlSignature: controlState.controlSignature,
      answerText: fingerprint
    });
    lastSnapshot = buildDiagnosticSnapshot(
      controlState,
      state,
      baselineControlSignature,
      fingerprint
    );

    if (Date.now() - lastDiagnosticLogAt >= DIAGNOSTIC_LOG_INTERVAL_MS) {
      logDiagnostic("completion-heartbeat", lastSnapshot);
      lastDiagnosticLogAt = Date.now();
    }

    if (state.isComplete) {
      logDiagnostic("completion-detected", lastSnapshot);
      return state;
    }

    await sleep(800);
  }

  console.error("[GEO][deepseek] completion-timeout", lastSnapshot || {
    elapsedMs: Date.now() - startTime,
    baselineControlSignature: summarizeSignature(baselineControlSignature)
  });
  throw new Error(`Answer timeout after ${maxWaitTime / 1000} seconds`);
}

// Extract answer text from last message
async function extractAnswerText(snapshot = null) {
  try {
    if (snapshot) {
      const extraction = extractAssistantAnswerAfterSnapshot(snapshot);
      logAnswerExtraction(snapshot, extraction);
      return extraction.text || "";
    }
    return extractLatestAssistantTextFromDom();
  } catch (error) {
    console.error("Failed to extract answer:", error);
    return "";
  }
}

async function waitForFreshAnswerText(snapshot, previousAnswerText, timeoutMs = 8000) {
  const start = Date.now();
  const normalizedPrevAnswer = normalizeForCompare(previousAnswerText);
  let latestAnswer = "";

  while (Date.now() - start < timeoutMs) {
    latestAnswer = await extractAnswerText(snapshot);
    const normalizedAnswer = normalizeForCompare(latestAnswer);

    if (normalizedAnswer && normalizedAnswer !== normalizedPrevAnswer) {
      logDiagnostic("answer-buffer-detected", {
        waitMs: Date.now() - start,
        answerLength: normalizedAnswer.length
      });
      return latestAnswer;
    }

    await sleep(500);
  }

  logDiagnostic("answer-buffer-timeout", {
    waitMs: Date.now() - start,
    previousAnswerLength: normalizedPrevAnswer.length
  });
  return latestAnswer;
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

    const baselineSnapshot = captureAssistantSnapshot();
    const previousAnswerText = baselineSnapshot.latestText;
    const previousFingerprint = getStreamingFingerprint();
    const submission = await submitQuestionWithRetry(
      input,
      questionData.question,
      previousFingerprint
    );

    console.log(`Question sent via ${submission.sendMethod}, waiting for answer...`);
    const completionState = await waitForAnswerComplete(
      previousFingerprint,
      input,
      submission.baselineControlSignature
    );

    await dismissImageFullscreen();
    let answerText = await extractAnswerText(baselineSnapshot);
    const normalizedPrevAnswer = normalizeForCompare(previousAnswerText);
    let normalizedAnswer = normalizeForCompare(answerText);

    if (!normalizedAnswer || normalizedAnswer === normalizedPrevAnswer) {
      answerText = await waitForFreshAnswerText(baselineSnapshot, previousAnswerText);
      normalizedAnswer = normalizeForCompare(answerText);
    }

    if (!normalizedAnswer || normalizedAnswer === normalizedPrevAnswer) {
      throw new Error("No new assistant answer detected for current question");
    }

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



