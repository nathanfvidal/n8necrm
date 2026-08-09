import { expect } from "vitest";

expect.extend({
  toBeInTheDocument(received) {
    const isInDocument = received && received.ownerDocument && document.body.contains(received);
    return {
      pass: isInDocument,
      message: () => `expected element to be in the document`,
    };
  },
  toHaveAttribute(received, attr, value) {
    const hasAttr = received.hasAttribute ? received.hasAttribute(attr) : false;
    const attrValue = received.getAttribute ? received.getAttribute(attr) : null;
    const pass = value !== undefined ? hasAttr && attrValue === value : hasAttr;
    return {
      pass,
      message: () => `expected element to have attribute ${attr}${value ? `="${value}"` : ""}`,
    };
  },
});
