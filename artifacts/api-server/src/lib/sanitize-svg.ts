import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_SVG_BYTES = 1024 * 1024;
const MAX_NODES = 5000;
const MAX_DEPTH = 48;
const MAX_PATH_DATA = 300_000;
const ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern",
  "title", "desc", "text", "tspan", "style",
]);
const ATTRIBUTES = new Set([
  "id", "class", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "opacity",
  "transform", "clip-path", "clip-rule", "mask", "vector-effect", "display", "visibility",
  "color", "width", "height", "viewBox", "preserveAspectRatio", "xmlns", "xmlns:xlink",
  "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "d", "points",
  "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color",
  "stop-opacity", "patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits",
  "maskUnits", "maskContentUnits", "font-family", "font-size", "font-style",
  "font-weight", "text-anchor", "dominant-baseline", "letter-spacing", "href",
  "xlink:href", "style",
]);
const CSS_PROPERTIES = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-opacity", "opacity", "color", "visibility", "display",
]);
const ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const INTERNAL_URL = /^url\(\s*#([A-Za-z_][A-Za-z0-9_.-]{0,127})\s*\)$/i;
const COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{1,24}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+-]{1,80}\)|none|currentColor|transparent|inherit)$/i;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px|pt|pc|mm|cm|in|%)?$/i;

function cleanDeclarations(value: string): string | null {
  if (value.length > 4096 || /(?:url|expression|javascript|@import|\\|\/\*)/i.test(value)) return null;
  const declarations: string[] = [];
  for (const part of value.split(";")) {
    if (!part.trim()) continue;
    const separator = part.indexOf(":");
    if (separator < 1) return null;
    const property = part.slice(0, separator).trim().toLowerCase();
    const content = part.slice(separator + 1).trim();
    if (!CSS_PROPERTIES.has(property) || !COLOR.test(content) && !NUMBER.test(content)) return null;
    declarations.push(`${property}:${content}`);
  }
  return declarations.join(";");
}

function cleanStyleSheet(value: string): string | null {
  if (value.length > 32_000 || /(?:@|url|expression|javascript|\\|\/\*)/i.test(value)) return null;
  const rules = [...value.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  if (!rules.length || rules.map(rule => rule[0]).join("").replace(/\s/g, "") !== value.replace(/\s/g, "")) return null;
  const safeRules: string[] = [];
  for (const [, rawSelector, rawDeclarations] of rules) {
    const selectors = rawSelector!.split(",").map(selector => selector.trim());
    if (selectors.some(selector => !/^(?:svg|g|path|rect|circle|ellipse|line|polyline|polygon|#[\w.-]+|\.[\w.-]+)$/.test(selector))) return null;
    const declarations = cleanDeclarations(rawDeclarations!);
    if (declarations === null) return null;
    safeRules.push(`${selectors.join(",")}{${declarations}}`);
  }
  return safeRules.join("");
}

function safeAttribute(name: string, value: string): string | null {
  if (!ATTRIBUTES.has(name) || value.length > 300_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return null;
  if (name === "id") return ID.test(value) ? value : null;
  if (name === "class") return value.split(/\s+/).every(token => ID.test(token)) ? value : null;
  if (name === "href" || name === "xlink:href") return /^#[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(value) ? value : null;
  if (name === "xmlns") return value === SVG_NS ? value : null;
  if (name === "xmlns:xlink") return value === "http://www.w3.org/1999/xlink" ? value : null;
  if (name === "viewBox") {
    const numbers = value.trim().split(/[ ,]+/).map(Number);
    return numbers.length === 4 && numbers.every(Number.isFinite)
      && numbers[2]! > 0 && numbers[3]! > 0 && numbers.every(number => Math.abs(number) <= 100_000) ? value : null;
  }
  if (name === "style") return cleanDeclarations(value);
  if (["d", "points", "transform", "gradientTransform", "patternTransform"].includes(name)) {
    return /^[A-Za-z0-9.,+\-\s()%]*$/.test(value) ? value : null;
  }
  if (["clip-path", "mask", "fill", "stroke"].includes(name) && /url\s*\(/i.test(value)) {
    return INTERNAL_URL.test(value) ? value : null;
  }
  if (["fill", "stroke", "stop-color", "color"].includes(name)) return COLOR.test(value) || INTERNAL_URL.test(value) ? value : null;
  if (name === "font-family") return /^[A-Za-z0-9 ,_-]{1,128}$/.test(value) ? value : null;
  if (["font-style", "font-weight", "text-anchor", "dominant-baseline", "stroke-linecap", "stroke-linejoin",
    "fill-rule", "clip-rule", "vector-effect", "display", "visibility", "gradientUnits",
    "spreadMethod", "patternUnits", "patternContentUnits", "clipPathUnits", "maskUnits", "maskContentUnits",
    "preserveAspectRatio"].includes(name)) {
    return /^[A-Za-z0-9 ,_-]{1,128}$/.test(value) ? value : null;
  }
  return NUMBER.test(value) ? value : null;
}

/** Remove active/external SVG constructs before librsvg rasterizes untrusted input. */
export function sanitizeSvgForRasterization(input: Buffer): Buffer {
  if (input.length < 5 || input.length > MAX_SVG_BYTES) throw new Error("invalid_svg");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new Error("invalid_svg");
  }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new Error("invalid_svg");

  const parseErrors: string[] = [];
  let document: Document;
  try {
    document = new DOMParser({
      onError: (level, message) => { parseErrors.push(`${level}:${message}`); },
    }).parseFromString(source, "image/svg+xml") as unknown as Document;
  } catch {
    throw new Error("invalid_svg");
  }
  if (parseErrors.length || document.doctype) throw new Error("invalid_svg");
  const root = document.documentElement;
  if (!root || (root.localName || root.nodeName.split(":").at(-1)) !== "svg"
    || root.namespaceURI && root.namespaceURI !== SVG_NS) throw new Error("invalid_svg");

  let nodes = 0, depthLimit = 0, pathData = 0;
  const sanitize = (element: Element, depth: number): void => {
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES) throw new Error("invalid_svg");
    const localName = element.localName || element.nodeName.split(":").at(-1) || "";
    if (!ELEMENTS.has(localName)) {
      element.parentNode?.removeChild(element);
      return;
    }
    if (localName === "style") {
      const stylesheet = cleanStyleSheet(element.textContent ?? "");
      if (stylesheet === null) element.parentNode?.removeChild(element);
      else element.textContent = stylesheet;
      return;
    }
    for (let index = element.attributes.length - 1; index >= 0; index--) {
      const attribute = element.attributes.item(index)!;
      const name = attribute.name;
      const cleaned = safeAttribute(name, attribute.value);
      if (cleaned === null) element.removeAttributeNode(attribute);
      else if (cleaned !== attribute.value) element.setAttribute(name, cleaned);
      if (name === "d") pathData += attribute.value.length;
    }
    if (pathData > MAX_PATH_DATA) throw new Error("invalid_svg");
    for (let child = element.firstChild; child; ) {
      const next = child.nextSibling;
      if (child.nodeType === 1) sanitize(child as Element, depth + 1);
      child = next;
    }
    depthLimit = Math.max(depthLimit, depth);
  };
  sanitize(root, 0);
  if (depthLimit > MAX_DEPTH) throw new Error("invalid_svg");
  if (!root.hasAttribute("xmlns")) root.setAttribute("xmlns", SVG_NS);
  return Buffer.from(new XMLSerializer().serializeToString(root));
}
