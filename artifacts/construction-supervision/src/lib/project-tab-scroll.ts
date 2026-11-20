export interface ProjectTabScrollPosition {
  navTop: number;
  navScrollLeft: number;
}

interface ScrollableElement {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  clientHeight: number;
  getBoundingClientRect: () => { top: number };
}

export function captureProjectTabScrollPosition(
  scrollContainer: ScrollableElement,
  navContainer: ScrollableElement,
): ProjectTabScrollPosition {
  return {
    navTop: navContainer.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top,
    navScrollLeft: navContainer.scrollLeft,
  };
}

export function restoreProjectTabScrollPosition(
  scrollContainer: ScrollableElement,
  navContainer: ScrollableElement,
  savedPosition: ProjectTabScrollPosition,
): boolean {
  const currentNavTop = navContainer.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top;
  const adjustedScrollTop = scrollContainer.scrollTop + currentNavTop - savedPosition.navTop;
  const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  const targetScrollTop = Math.min(Math.max(0, adjustedScrollTop), maxScrollTop);

  scrollContainer.scrollTop = targetScrollTop;
  navContainer.scrollLeft = savedPosition.navScrollLeft;

  return Math.abs(targetScrollTop - adjustedScrollTop) <= 1;
}
