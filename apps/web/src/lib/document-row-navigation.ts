const ROW_NAVIGATION_CONTROL_SELECTOR =
  "a,button,input,select,textarea,[data-row-action]";

export function getDocumentDetailHref(documentId: string) {
  return `/documents/${documentId}`;
}

export function shouldIgnoreDocumentRowNavigation(target: EventTarget | null) {
  if (!target || !("closest" in target)) {
    return false;
  }

  const element = target as { closest(selector: string): unknown };
  return Boolean(element.closest(ROW_NAVIGATION_CONTROL_SELECTOR));
}
