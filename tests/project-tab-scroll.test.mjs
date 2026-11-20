import assert from "node:assert/strict";
import test from "node:test";
import {
  captureProjectTabScrollPosition,
  restoreProjectTabScrollPosition,
} from "../artifacts/construction-supervision/src/lib/project-tab-scroll.ts";

test("restores the tab bar to the same viewport position after page content changes", () => {
  const sourceScroll = {
    scrollTop: 150,
    scrollLeft: 0,
    scrollHeight: 1200,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 80 }),
  };
  const sourceNav = {
    scrollTop: 0,
    scrollLeft: -84,
    scrollHeight: 0,
    clientHeight: 0,
    getBoundingClientRect: () => ({ top: 240 }),
  };

  const saved = captureProjectTabScrollPosition(sourceScroll, sourceNav);

  const destinationScroll = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 1200,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 80 }),
  };
  const destinationNav = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 0,
    clientHeight: 0,
    getBoundingClientRect: () => ({ top: 360 }),
  };

  restoreProjectTabScrollPosition(destinationScroll, destinationNav, saved);

  assert.equal(saved.navTop, 160);
  assert.equal(destinationScroll.scrollTop, 120);
  assert.equal(destinationNav.scrollLeft, -84);
});

test("does not attempt a negative scroll position", () => {
  const scrollContainer = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 500,
    clientHeight: 500,
    getBoundingClientRect: () => ({ top: 0 }),
  };
  const navContainer = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 0,
    clientHeight: 0,
    getBoundingClientRect: () => ({ top: 20 }),
  };

  restoreProjectTabScrollPosition(scrollContainer, navContainer, {
    navTop: 60,
    navScrollLeft: 0,
  });

  assert.equal(scrollContainer.scrollTop, 0);
});

test("retries when the destination page has not loaded enough content to scroll", () => {
  const scrollContainer = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 500,
    clientHeight: 500,
    getBoundingClientRect: () => ({ top: 0 }),
  };
  const navContainer = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 0,
    clientHeight: 0,
    getBoundingClientRect: () => ({ top: 150 - scrollContainer.scrollTop }),
  };
  const saved = { navTop: 100, navScrollLeft: -60 };

  assert.equal(restoreProjectTabScrollPosition(scrollContainer, navContainer, saved), false);
  assert.equal(scrollContainer.scrollTop, 0);
  scrollContainer.scrollHeight = 1000;

  assert.equal(restoreProjectTabScrollPosition(scrollContainer, navContainer, saved), true);
  assert.equal(scrollContainer.scrollTop, 50);
  assert.equal(navContainer.scrollLeft, -60);
});
