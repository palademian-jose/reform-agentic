import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "./overlayScript";

test("getNormalizedFlowLabel normalizes cart label variants", () => {
  assert.equal(__test__.getNormalizedFlowLabel("Add to Cart"), "add to cart");
  assert.equal(__test__.getNormalizedFlowLabel("add-to-cart"), "add to cart");
  assert.equal(__test__.getNormalizedFlowLabel("add_to_cart"), "add to cart");
  assert.equal(__test__.getNormalizedFlowLabel("addToCart"), "add to cart");
});

test("isLikelyActionLabel accepts normalized cart variants", () => {
  assert.equal(__test__.isLikelyActionLabel("Add to Cart"), true);
  assert.equal(__test__.isLikelyActionLabel("add-to-cart"), true);
  assert.equal(__test__.isLikelyActionLabel("addToCart"), true);
  assert.equal(__test__.isLikelyActionLabel("Product details"), false);
});

test("buildActionText includes aria and title labels without duplicates", () => {
  const label = __test__.buildActionText("", "Add to Cart", "add-to-cart", "fallback");
  assert.equal(label, "Add to Cart");
});

test("getActionLabelText falls back to aria-label and title", () => {
  const fromAria = __test__.getActionLabelText({
    innerText: "",
    textContent: "",
    getAttribute(name: string) {
      return name === "aria-label" ? "Add to Cart" : null;
    },
  }, "fallback");
  assert.equal(fromAria, "Add to Cart");

  const fromTitle = __test__.getActionLabelText({
    innerText: "",
    textContent: "",
    getAttribute(name: string) {
      return name === "title" ? "Proceed to Checkout" : null;
    },
  }, "fallback");
  assert.equal(fromTitle, "Proceed to Checkout");
});

test("scoreFunctionCandidate boosts action-oriented handlers", () => {
  assert.ok(__test__.scoreFunctionCandidate("handleAddToCart") > __test__.scoreFunctionCandidate("ProductCard"));
  assert.ok(__test__.scoreFunctionCandidate("addToCart") > __test__.scoreFunctionCandidate("renderPage"));
});

test("normalized labels dedupe equivalent separator variants", () => {
  const variants = ["Add to Cart", "add-to-cart", "add_to_cart", "addToCart"];
  const keys = new Set(variants.map((variant) => __test__.getNormalizedFlowLabel(variant)));
  assert.deepEqual([...keys], ["add to cart"]);
});
