// Element locator with multi-selector fallback strategy
class ElementLocator {
  constructor(platform, selectors) {
    this.platform = platform;
    this.selectors = selectors[platform] || {};
  }

  // Locate element by type (inputBox, sendButton, etc.)
  async locate(elementType, timeout = 5000) {
    const selectorList = this.selectors[elementType];

    if (!selectorList || selectorList.length === 0) {
      throw new Error(`No selectors defined for ${elementType}`);
    }

    const startTime = Date.now();
    const sorted = selectorList.slice().sort((a, b) => a.priority - b.priority);

    // Try each selector in priority order
    for (const selector of sorted) {
      const remain = Math.max(0, timeout - (Date.now() - startTime));
      if (remain === 0) break;

      const element = await this.trySelector(selector, remain);
      if (element) {
        console.log(`Located ${elementType} using ${selector.type}: ${selector.value}`);
        return element;
      }
    }

    throw new Error(`Failed to locate ${elementType} after trying all selectors`);
  }

  // Try a single selector with polling
  async trySelector(selector, timeout) {
    const endTime = Date.now() + timeout;

    while (Date.now() < endTime) {
      let element = null;

      switch (selector.type) {
        case "css":
        case "attribute":
          element = document.querySelector(selector.value);
          break;
        case "xpath":
        case "text":
          element = this.getElementByXPath(selector.value);
          break;
        case "position":
          element = this.getElementByPosition(selector.value);
          break;
        default:
          break;
      }

      if (element && this.isVisible(element)) {
        return element;
      }

      await this.sleep(100);
    }

    return null;
  }

  // Get element by XPath
  getElementByXPath(xpath) {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  }

  // Get element by position relationship
  getElementByPosition(positionType) {
    if (positionType === "input-sibling-button") {
      const input = document.querySelector("textarea, input[type='text']");
      if (input) {
        return input.parentElement ? input.parentElement.querySelector("button") : null;
      }
    }
    return null;
  }

  // Check if element is visible
  isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  // Sleep helper
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

if (typeof window !== "undefined") {
  window.ElementLocator = ElementLocator;
}
